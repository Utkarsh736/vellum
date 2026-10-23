/**
 * Apple HIG-style sidebar: library sections + a privacy footer.
 * Selected row uses the translucent-accent treatment; whole bar sits on a
 * slightly recessed surface (HIG "Sidebar" pattern).
 */
import { IconBook, IconCheck, IconProgress, IconShield } from "./icons";
import { cx } from "../lib/format";

export type LibraryFilter = "all" | "reading" | "finished";

interface Props {
  current: LibraryFilter;
  onSelect: (filter: LibraryFilter) => void;
  counts: { all: number; reading: number; finished: number };
}

const SECTIONS: Array<{
  id: LibraryFilter;
  label: string;
  icon: typeof IconBook;
}> = [
  { id: "all", label: "Library", icon: IconBook },
  { id: "reading", label: "Reading", icon: IconProgress },
  { id: "finished", label: "Finished", icon: IconCheck },
];

export function Sidebar({ current, onSelect, counts }: Props) {
  return (
    <nav
      aria-label="Library sections"
      className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-surface/60 backdrop-blur-xl"
    >
      <div className="px-4 pb-2 pt-5">
        <h1 className="font-display text-[17px] font-bold tracking-tight text-ink">
          Vellum
        </h1>
        <p className="text-[11px] text-ink-3">PDF · EPUB · Offline</p>
      </div>

      <ul className="flex-1 space-y-0.5 px-2.5 pt-3">
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const selected = current === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                aria-current={selected ? "page" : undefined}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-[13px] font-medium",
                  "min-h-[34px] transition-colors",
                  selected
                    ? "bg-accent-soft text-accent"
                    : "text-ink-2 hover:bg-line-soft hover:text-ink",
                )}
              >
                <Icon size={16} />
                <span className="flex-1 text-left">{label}</span>
                <span
                  className={cx(
                    "font-mono text-[11px] tabular-nums",
                    selected ? "text-accent" : "text-ink-3",
                  )}
                  aria-hidden="true"
                >
                  {counts[id]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-line px-4 py-3.5">
        <div className="flex items-center gap-2 text-ink-2">
          <IconShield size={15} />
          <p className="text-[11px] leading-tight">
            100% offline · no telemetry · no network access
          </p>
        </div>
      </footer>
    </nav>
  );
}
