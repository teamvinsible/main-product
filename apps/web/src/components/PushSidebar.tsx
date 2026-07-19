import { useEffect, useRef, type ReactNode } from "react";
import { IconClose } from "./icons";

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * In-layout detail panel that pushes the main spine UI aside
 * (not a modal overlay — main content stays interactive).
 */
export function PushSidebar({ open, title, subtitle, onClose, children }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  return (
    <aside
      className={`push-sidebar ${open ? "is-open" : ""}`}
      aria-hidden={!open}
      aria-label={open ? title : undefined}
    >
      <div className="push-sidebar-inner card">
        <header className="push-sidebar-head">
          <div className="push-sidebar-head-copy">
            <h2 className="push-sidebar-title">{title}</h2>
            {subtitle ? <p className="push-sidebar-sub">{subtitle}</p> : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="push-sidebar-close"
            onClick={onClose}
            aria-label="Close detail"
          >
            <IconClose size={16} />
          </button>
        </header>
        <div className="push-sidebar-body">{children}</div>
      </div>
    </aside>
  );
}
