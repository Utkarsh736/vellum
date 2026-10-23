/** Bottom-center toast queue (aria-live polite). */
import { cx } from "../lib/format";
import type { Toast } from "../state/LibraryContext";

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2
                 flex-col items-center gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "rounded-card border px-4 py-2 text-[13px] font-medium shadow-[0_12px_32px_rgba(17,17,17,0.22)]",
            t.tone === "danger" && "border-danger/30 bg-danger-soft text-danger",
            t.tone === "success" && "border-success/25 bg-success-soft text-success",
            t.tone === "info" && "border-line bg-elevated text-ink",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
