/**
 * EPUB reader (Step 2/4): epub.js paginated rendition with the Paper reading
 * theme (serif 18px / 1.6), font-size controls, keyboard nav and debounced
 * progress persistence via EPUB CFI locators.
 *
 * Privacy notes:
 *  - The book is opened from an in-memory ArrayBuffer — epub.js never fetches.
 *  - `allowScriptedContent: false` — EPUB-internal scripts never run.
 *  - CSP (index.html + tauri.conf.json) blocks every remote origin anyway.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import ePub, { type Book, type Rendition, type RelocatedLocation } from "epubjs";
import type { Book as BookRecord } from "../../lib/types";
import { readBookFile } from "../../lib/tauri";
import {
  ProgressSaver,
  decodeLocation,
  encodeLocation,
} from "../../readers/progress";
import { ReaderShell, ReaderIconButton } from "./ReaderShell";
import { IconType } from "../icons";

interface Props {
  book: BookRecord;
  onBack: () => void;
}

type LoadState =
  | { phase: "loading" | "ready" }
  | { phase: "error"; message: string };

const MIN_FONT = 14;
const MAX_FONT = 26;
const FONT_KEY = "vellum.readingSize";

function initialFontSize(): number {
  const stored = Number(localStorage.getItem(FONT_KEY));
  return Number.isFinite(stored) && stored >= MIN_FONT && stored <= MAX_FONT
    ? stored
    : 18; // spec default: 18px
}

export function EpubReader({ book, onBack }: Props) {
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });
  const [fontSize, setFontSize] = useState(initialFontSize);
  // The reader is modal: read the app's current appearance once at mount
  // (documentElement carries the source of truth set by useTheme in App).
  const [dark] = useState(
    () => document.documentElement.classList.contains("dark"),
  );

  const hostRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookObjRef = useRef<Book | null>(null);
  const saverRef = useRef<ProgressSaver | null>(null);

  /** Apply the Paper reading theme (colors + typography) to the rendition. */
  const applyTheme = useCallback((size: number, dark: boolean) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.default({
      body: {
        color: dark ? "#d6d6d0" : "#1a1a1a",
        background: dark ? "#141414" : "#fcfcf9",
        "font-family": 'Georgia, "Iowan Old Style", "Times New Roman", serif',
        "font-size": `${size}px`,
        "line-height": "1.6",
        padding: "0.4em !important",
      },
      p: { "line-height": "1.6 !important" },
      "a, a:link": { color: dark ? "#a78bfa" : "#7c3aed" },
    });
  }, []);

  // ---- Boot ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const saver = new ProgressSaver(book.id);
    saverRef.current = saver;

    (async () => {
      try {
        const buf = await readBookFile(book.file_path);
        if (cancelled) return;

        const epubBook = ePub(buf);
        bookObjRef.current = epubBook;

        const rendition = epubBook.renderTo(hostRef.current!, {
          width: "100%",
          height: "100%",
          spread: "none", // single column
          allowScriptedContent: false, // EPUB scripts stay off (hardening)
        });
        renditionRef.current = rendition;

        applyTheme(initialFontSize(), document.documentElement.classList.contains("dark"));

        // Keyboard events inside epub.js iframes re-emitted on the rendition.
        const onRenditionKey = (e: KeyboardEvent) => {
          if (e.key === "ArrowLeft") void rendition.prev();
          if (e.key === "ArrowRight") void rendition.next();
        };
        rendition.on("keydown", onRenditionKey);

        const onRelocated = (loc: RelocatedLocation) => {
          if (cancelled) return;
          const cfi = loc.start.cfi;
          // spine-index estimate — epub.js only knows exact percentages when
          // locations were generated (see docs/READING_ENGINE.md).
          const spineLen = Math.max(1, epubBook.spine?.length ?? 1);
          const percent =
            loc.start.percentage ??
            Math.min(1, (loc.start.index + 1) / spineLen);
          saver.save(percent, encodeLocation({ type: "epub", cfi }));
        };
        rendition.on("relocated", onRelocated);

        const savedLoc = decodeLocation(book.last_read_location);
        await rendition.display(savedLoc?.type === "epub" ? savedLoc.cfi : undefined);
        if (cancelled) return;
        setLoad({ phase: "ready" });
      } catch (e) {
        if (cancelled) return;
        setLoad({
          phase: "error",
          message:
            e instanceof Error ? e.message : "Could not open this EPUB.",
        });
      }
    })();

    return () => {
      cancelled = true;
      renditionRef.current?.destroy();
      renditionRef.current = null;
      void bookObjRef.current?.destroy();
      bookObjRef.current = null;
      saverRef.current?.close();
      saverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // ---- Resize handling ----------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => renditionRef.current?.resize?.(), 120);
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      if (t) clearTimeout(t);
    };
  }, []);

  // ---- Theme / font-size sync --------------------------------------------
  useEffect(() => {
    applyTheme(fontSize, dark);
    localStorage.setItem(FONT_KEY, String(fontSize));
  }, [applyTheme, fontSize, dark]);

  // ---- Window-level keyboard (when iframe lacks focus) --------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") void renditionRef.current?.prev();
      if (e.key === "ArrowRight") void renditionRef.current?.next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shrink = useCallback(
    () => setFontSize((s) => Math.max(MIN_FONT, s - 1)),
    [],
  );
  const grow = useCallback(
    () => setFontSize((s) => Math.min(MAX_FONT, s + 1)),
    [],
  );

  const actions = (
    <>
      <ReaderIconButton label="Smaller text" onClick={shrink}>
        <span className="text-[12px] font-semibold">A−</span>
      </ReaderIconButton>
      <ReaderIconButton label="Larger text" onClick={grow}>
        <span className="text-[15px] font-semibold">A+</span>
      </ReaderIconButton>
      <ReaderIconButton label="Reset text size" onClick={() => setFontSize(18)}>
        <IconType size={16} />
      </ReaderIconButton>
    </>
  );

  return (
    <ReaderShell
      title={book.title}
      subtitle={`${book.author ?? "Unknown author"} · EPUB`}
      onBack={onBack}
      actions={actions}
    >
      <div
        className="h-full"
        style={{ background: dark ? "#141414" : "#fcfcf9" }}
      >
        {load.phase === "error" && (
          <div className="flex h-full items-center justify-center p-8">
            <p className="max-w-[420px] text-center text-[13px] leading-relaxed text-danger">
              {load.message}
            </p>
          </div>
        )}
        {/* epub.js mounts its iframe tree here */}
        <div
          ref={hostRef}
          className={load.phase === "error" ? "hidden" : "h-full"}
          role="document"
          aria-label="EPUB content"
        />
      </div>
    </ReaderShell>
  );
}
