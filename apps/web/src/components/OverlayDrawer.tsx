import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./icons";

type OverlayDrawerProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
};

export function OverlayDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  wide,
}: OverlayDrawerProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={`overlay-drawer-root ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <button
        type="button"
        className="overlay-drawer-backdrop"
        aria-label="Close panel"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside
        className={`overlay-drawer ${wide ? "is-wide" : ""} ${open ? "is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="overlay-drawer-head">
          <div className="overlay-drawer-head-copy">
            <h2 id={titleId} className="overlay-drawer-title">
              {title}
            </h2>
            {subtitle && <p className="overlay-drawer-sub">{subtitle}</p>}
          </div>
          <button type="button" className="overlay-drawer-close" onClick={onClose} aria-label="Close">
            <IconClose size={18} />
          </button>
        </header>
        <div className="overlay-drawer-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
