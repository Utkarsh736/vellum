/**
 * Toolbar (HIG window-toolbar pattern): search field, sort menu,
 * theme toggle, "Add Books" primary action. `/` focuses search, ⌘O adds.
 */
import { useEffect, useRef, useState } from "react";
import { IconCheck, IconPlus, IconSearch, IconSort, IconSun, IconMoon } from "./icons";
import { cx } from "../lib/format";
import type { Theme } from "../hooks/useTheme";

export type SortKey = "recent" | "title" | "author" | "progress";

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "recent", label: "Recently added" },
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
  { id: "progress", label: "Progress" },
];

interface Props {
  query: string;
  onQuery: (q: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  theme: Theme;
  onToggleTheme: () => void;
  onAdd: () => void;
  resultCount: number;
}

export function Toolbar({
  query,
  onQuery,
  sort,
  onSort,
  theme,
  onToggleTheme,
  onAdd,
  resultCount,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // "/" focuses search (Step 5 keyboard pass) — unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click-away + Escape for the sort menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header
      className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-surface/80 px-6 backdrop-blur-xl"
      role="toolbar"
      aria-label="Library toolbar"
    >
      <div className="relative min-w-0 flex-1 max-w-[340px]">
        <IconSearch
          size={15}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search title or author…  ( / )"
          aria-label="Search library by title or author"
          className="h-[32px] w-full rounded-input border border-line bg-bg pl-8 pr-3
                     text-[13px] text-ink placeholder:text-ink-3
                     focus:border-accent-fill focus:outline-none"
        />
      </div>

      <span
        className="text-[12px] tabular-nums text-ink-3"
        aria-live="polite"
        aria-label={`${resultCount} books shown`}
      >
        {resultCount} {resultCount === 1 ? "book" : "books"}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex h-[32px] items-center gap-1.5 rounded-btn border border-line bg-surface
                       px-2.5 text-[12px] font-medium text-ink-2 hover:bg-line-soft hover:text-ink"
          >
            <IconSort size={15} />
            {SORTS.find((s) => s.id === sort)?.label}
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="Sort library"
              className="absolute right-0 top-[38px] z-30 min-w-[180px] overflow-hidden
                         rounded-card border border-line bg-elevated p-1
                         shadow-[0_12px_32px_rgba(17,17,17,0.16)]"
            >
              {SORTS.map(({ id, label }) => (
                <button
                  key={id}
                  role="menuitemradio"
                  aria-checked={sort === id}
                  onClick={() => {
                    onSort(id);
                    setMenuOpen(false);
                  }}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-[8px] px-2.5 py-[7px] text-left text-[13px]",
                    sort === id
                      ? "text-accent"
                      : "text-ink-2 hover:bg-line-soft hover:text-ink",
                  )}
                >
                  <span className="w-4">
                    {sort === id && <IconCheck size={14} />}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light appearance" : "Switch to dark appearance"
          }
          className="flex h-[32px] w-[32px] items-center justify-center rounded-btn border
                     border-line bg-surface text-ink-2 hover:bg-line-soft hover:text-ink"
        >
          {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>

        <button
          type="button"
          onClick={onAdd}
          className="flex h-[32px] items-center gap-1.5 rounded-btn bg-ink px-3.5
                     text-[12px] font-semibold text-bg hover:opacity-85
                     dark:bg-ink dark:text-bg"
          title="Add books (⌘O)"
        >
          <IconPlus size={15} />
          Add Books
        </button>
      </div>
    </header>
  );
}
