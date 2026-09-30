/**
 * Kleine Rückfrage vor einem Schritt, der Arbeit ersetzen würde (Nutzer-Review 24.09.2026): eigener Dialog im
 * Stil der übrigen Fenster (`modal-backdrop`/`modal`) statt `window.confirm`.
 */
export function ConfirmDialog(props: {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" style={{ maxWidth: 420 }}>
        <header className="modal-head">
          <h2 id="confirm-title">{props.title}</h2>
        </header>
        <p>{props.body}</p>
        <div className="row end">
          <button type="button" onClick={props.onCancel}>
            {props.cancelLabel ?? 'Abbrechen'}
          </button>
          <button type="button" className="primary" onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
