import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Aufklappmenü (W2-ED U2): Knopf mit Pfeil, darunter eine Liste. Klick daneben oder Esc schließt; ein Eintrag schließt
 * über `close`. Seltenes wandert hierher („Neu ▾“, „⋯“, „Schnitt ▾“, „Ansicht ▾“), damit die Oberfläche klein bleibt.
 */
export function DropMenu(props: {
  readonly label: ReactNode;
  readonly title: string;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly align?: 'left' | 'right';
  readonly disabled?: boolean;
  readonly children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (host.current !== null && !host.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className={`menu-host${props.className !== undefined ? ` ${props.className}` : ''}`} ref={host}>
      <button
        type="button"
        className={`menu-button${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={props.ariaLabel}
        title={props.title}
        disabled={props.disabled === true}
        onClick={() => setOpen((o) => !o)}
      >
        {props.label}
      </button>
      {open && (
        <div className={`menu-pop ${props.align ?? 'right'}`} role="menu">
          {props.children(close)}
        </div>
      )}
    </div>
  );
}

/** Eintrag eines Aufklappmenüs: führt aus und schließt. */
export function MenuItem(props: { readonly onSelect: () => void; readonly close: () => void; readonly children: ReactNode; readonly hint?: string; readonly disabled?: boolean; readonly title?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={props.disabled === true}
      title={props.title}
      onClick={() => {
        props.close();
        props.onSelect();
      }}
    >
      <span>{props.children}</span>
      {props.hint !== undefined && <span className="menu-hint">{props.hint}</span>}
    </button>
  );
}

/** Überschrift einer Gruppe im Menü. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}
