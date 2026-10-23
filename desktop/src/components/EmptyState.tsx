/** First-run empty state: explains the app and its privacy posture. */
import { IconBook, IconShield } from "./icons";

export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
      <div
        className="flex h-[76px] w-[76px] items-center justify-center rounded-card
                   bg-accent-soft text-accent"
        aria-hidden="true"
      >
        <IconBook size={34} />
      </div>
      <div className="max-w-[420px] space-y-2">
        <h2 className="font-display text-[19px] font-semibold text-ink">
          Your shelf is empty
        </h2>
        <p className="text-[13px] leading-relaxed text-ink-2">
          Add PDF or EPUB files — drag them anywhere in this window, or use the
          button below. Books stay where they are on disk; Vellum never copies
          or uploads them.
        </p>
        <p className="flex items-center justify-center gap-1.5 pt-1 text-[12px] text-ink-3">
          <IconShield size={14} />
          Fully offline — no account, no telemetry, no network access
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="h-[36px] rounded-btn bg-ink px-4 text-[13px] font-semibold text-bg hover:opacity-85"
      >
        Add your first book
      </button>
    </div>
  );
}
