/**
 * Shared chrome for both readers: HIG-style top bar (back, title, actions),
 * Escape handling, and the reading surface container.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { IconChevronLeft } from "../icons";

interface Props {
  title: string;
  subtitle: string;
  onBack: () => void;
  /** Right-aligned controls (zoom, font size, …). */
  actions?: ReactNode;
  children: ReactNode;
}

export function ReaderShell({ title, subtitle, onBack, actions, children }: Props) {
  const backRef = useRef<HTMLButtonElement | null>(null);

  // Move focus into the reader so Escape is catchable and screen readers
  // announce the book being opened (WCAG 2.2 §2.4.3).
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  return (
    <div className="flex h-full flex-col bg-bg">
      <header
        className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur-xl"
        role="toolbar"
        aria-label="Reader controls"
      >
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          aria-label="Back to library (Esc)"
          className="flex h-[32px] items-center gap-1 rounded-btn px-2 text-[13px]
                     font-medium text-ink-2 hover:bg-line-soft hover:text-ink"
        >
          <IconChevronLeft size={17} />
          Library
        </button>

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[13px] font-semibold text-ink">{title}</p>
          <p className="truncate text-[11px] text-ink-3">{subtitle}</p>
        </div>

        <div className="flex items-center gap-1.5">{actions}</div>
      </header>

      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}

/** Small icon-button used in reader toolbars. */
export function ReaderIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-[32px] w-[32px] items-center justify-center rounded-btn border border-line
                 bg-surface text-ink-2 hover:bg-line-soft hover:text-ink
                 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
