/**
 * Custom right-click context menu for book cards.
 * Keyboard-accessible (menu role, Escape closes, click-away closes).
 */
import { useEffect, useRef } from "react";
import { IconTrash } from "./icons";

export interface ContextMenuState {
  bookId: number;
  x: number;
  y: number;
}

interface Props {
  state: ContextMenuState;
  onClose: () => void;
  onRemove: () => void;
}

export function BookContextMenu({ state, onClose, onRemove }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu inside the window.
  const x = Math.min(state.x, window.innerWidth - 200);
  const y = Math.min(state.y, window.innerHeight - 120);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Book actions"
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-card border border-line
                 bg-elevated p-1 shadow-[0_12px_32px_rgba(17,17,17,0.18)]"
    >
      <button
        role="menuitem"
        onClick={() => {
          onRemove();
          onClose();
        }}
        className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-[8px]
                   text-left text-[13px] font-medium text-danger hover:bg-danger-soft"
      >
        <IconTrash size={15} />
        Remove from Library…
      </button>
    </div>
  );
}
