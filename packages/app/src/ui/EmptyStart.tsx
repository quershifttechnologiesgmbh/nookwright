import { useEffect, useRef, useState } from 'react';

/**
 * Leerzustand (W1): Beim Erstbesuch ohne Räume zeigte der Editor ein kaum sichtbares Raster und eine leere 3D-Fläche.
 * Jetzt zwei klare Einstiege über der Bühne: „Bautyp wählen oder beschreiben“ (Assistent, Fokus im Beschreibungsfeld)
 * und „Selbst malen“ (Werkzeug Malen). Das Angebot „Fortsetzen“ eines Autosaves bleibt oben sichtbar und wird hier
 * zusätzlich genannt – es wird nicht verdrängt.
 */
export function EmptyStart(props: {
  readonly canDescribe: boolean;
  /** Name des zuletzt gespeicherten Projekts, solange „Fortsetzen“ angeboten wird. */
  readonly resumeName?: string | undefined;
  readonly onDescribe: () => void;
  readonly onPaint: () => void;
}) {
  // R1-19: beim Öffnen die Hauptaktion fokussieren – Enter öffnet den Assistenten, Tab führt zu „Selbst malen“.
  // Ohne Scrollen (mobil liegt die Karte unter der Kopfleiste); Tastenkürzel wirken weiter (kein Eingabefeld).
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="empty-start">
      <section className="empty-start-card" aria-labelledby="empty-start-title">
        <p className="eyebrow">Neues Projekt</p>
        <h2 id="empty-start-title">Wie willst du anfangen?</h2>
        <div className="empty-start-actions">
          <button ref={primaryRef} type="button" className="start-action primary" onClick={props.onDescribe} disabled={!props.canDescribe}>
            <strong>Bautyp wählen oder beschreiben</strong>
            <span>Taverne, Wachturm, Bauernhaus … oder in eigenen Worten. Drei Vorschläge zum Übernehmen.</span>
          </button>
          <button type="button" className="start-action" onClick={props.onPaint}>
            <strong>Selbst malen</strong>
            <span>Raumtyp links wählen, im Grundriss ein Rechteck aufziehen – der Raum wird sofort eingerichtet.</span>
          </button>
        </div>
        {props.resumeName !== undefined && (
          <p className="small muted empty-start-resume">Oder oben „Fortsetzen“: „{props.resumeName}“ liegt noch im Browser.</p>
        )}
      </section>
    </div>
  );
}

/** Gleiche Grenze wie das einspaltige Layout in `styles.css` (`@media (max-width: 720px)`), dazu Touch-Geräte. */
export const SMALL_SCREEN_QUERY = '(max-width: 720px), (pointer: coarse)';
const HINT_KEY = 'nookwright.smallScreenHint';

/** Media Query als Zustand (ohne `matchMedia`, z. B. in Tests: nie). */
function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Wurde der Hinweis in dieser Sitzung schon geschlossen? (Speicher gesperrt → nein; nur Komfort.) */
function hintDismissed(): boolean {
  try {
    return sessionStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Ehrlicher Hinweis auf kleinen Bildschirmen und Touch-Geräten (A7): Der Editor ist für Maus und großen Bildschirm
 * gebaut (Rechtecke aufziehen, Rechtsklick, Tastenkürzel). Schließbar; bleibt für die Sitzung geschlossen.
 */
export function SmallScreenHint() {
  const small = useMediaQuery(SMALL_SCREEN_QUERY);
  const [closed, setClosed] = useState(hintDismissed);
  if (!small || closed) return null;
  const close = () => {
    setClosed(true);
    try {
      sessionStorage.setItem(HINT_KEY, '1');
    } catch {
      // ohne Speicher: nur für diese Ansicht geschlossen
    }
  };
  return (
    <div className="small-screen-hint" role="note">
      <p>
        <strong>Für Maus und großen Bildschirm gebaut.</strong> Auf dem Handy kannst du Bautypen ansehen und übernehmen; Räume malen und bearbeiten geht am Computer
        deutlich besser.
      </p>
      <button type="button" className="link" onClick={close} aria-label="Hinweis schließen">
        ✕
      </button>
    </div>
  );
}
