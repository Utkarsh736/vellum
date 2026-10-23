/**
 * Lightweight modal dialog (HIG alert pattern): title, body, cancel +
 * destructive confirm. Escape cancels; focus starts on the safe action.
 */
import { useEffect, useRef } from "react";

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="w-full max-w-[380px] rounded-card border border-line bg-elevated p-5
                   shadow-[0_24px_64px_rgba(17,17,17,0.28)]"
      >
        <h2
          id="confirm-title"
          className="font-display text-[15px] font-semibold text-ink"
        >
          {title}
        </h2>
        <p id="confirm-body" className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          {body}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="h-[32px] rounded-btn border border-line bg-surface px-3.5
                       text-[12.5px] font-medium text-ink-2 hover:bg-line-soft hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-[32px] rounded-btn bg-danger px-3.5 text-[12.5px]
                       font-semibold text-white hover:opacity-88"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
