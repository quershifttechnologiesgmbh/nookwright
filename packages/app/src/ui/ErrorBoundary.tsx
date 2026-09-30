import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  readonly error: Error | undefined;
}

/**
 * Fehler beim Zeichnen eines Bereichs (z. B. 3D-Ansicht) bleiben sichtbar und auf diesen Bereich begrenzt:
 * Meldung statt leerer Seite, „Erneut versuchen“ baut den Bereich neu auf. `resetKey` setzt ebenfalls zurück.
 */
export class ErrorBoundary extends Component<{ label: string; resetKey?: unknown; onError?: (message: string) => void; children: ReactNode }, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(`${this.props.label}: ${error.message}`);
    console.error(error, info.componentStack);
  }

  override componentDidUpdate(prev: { resetKey?: unknown }): void {
    if (this.state.error !== undefined && prev.resetKey !== this.props.resetKey) this.setState({ error: undefined });
  }

  override render(): ReactNode {
    if (this.state.error === undefined) return this.props.children;
    return (
      <div className="viewer">
        <div className="viewer-failure" role="alert">
          <div>
            <p>
              <strong>{this.props.label} ist abgestürzt:</strong> {this.state.error.message}
            </p>
            <button type="button" onClick={() => this.setState({ error: undefined })}>
              Erneut versuchen
            </button>
          </div>
        </div>
      </div>
    );
  }
}
