// Einbettungs-Protokoll, Website-Seite (rein, ohne DOM): Warteschlange bis der Editor „bereit“ meldet, Absender-Prüfung,
// Ablehnung durch den Editor. `editor.js` verdrahtet es mit dem iframe; getestet in website/test/embed-model.test.ts.
//
// Vertrag (plan/spikes/W1_eine_app.md §3, Gegenseite packages/app/src/embed.ts), nur same-origin:
//   Editor → Seite  { type: 'nookwright:ready' }                      sobald Beschreibungen angenommen werden
//   Editor → Seite  { type: 'nookwright:rejected', reason: string }   Beschreibung nicht übernommen (z. B. ungültig)
//   Seite → Editor  { type: 'nookwright:describe', prompt, interpretation? }

export const EMBED_READY = 'nookwright:ready';
export const EMBED_DESCRIBE = 'nookwright:describe';
export const EMBED_REJECTED = 'nookwright:rejected';
/** Wie lange nach dem Laden des Editors auf `ready` gewartet wird, bevor ein Hinweis erscheint. */
export const READY_HINT_MS = 10_000;
/** Längster angezeigter Grund einer Ablehnung. */
const MAX_REASON = 160;

/**
 * Text für den Hinweis, wenn der Editor eine Beschreibung ablehnt (Grund nur, wenn kurz und lesbar).
 * @param {unknown} reason
 */
export function rejectedText(reason) {
  const base = 'Der Editor konnte die Beschreibung nicht übernehmen. Füge sie dort unter „Beschreibe dein Gebäude“ ein.';
  const r = typeof reason === 'string' ? reason.trim() : '';
  return userReason(r) ? `${base} Grund: ${r.replace(/[.\s]+$/, '')}.` : base;
}

/**
 * Nur Gründe in Nutzersprache anzeigen (Review R2-05): ein kurzer Satz mit Leerzeichen, ohne Vertragsdetails – keine
 * Feldpfade (`request.op`, `input.floors`), Bezeichner mit `_`, CamelCase, Klammern, Zeichen wie `=`/`<`/`` ` ``,
 * Zahlen-Grenzen („<= 8“) oder Protokoll-Wörter. Alles andere → allgemeiner Hinweis.
 * @param {string} r
 */
export function userReason(r) {
  if (r === '' || r.length > MAX_REASON || !/\s/.test(r)) return false;
  if (/[A-Za-z]\.[A-Za-z]|_|[a-z][A-Z]|[{}()[\]<>=`|\\/"]/.test(r)) return false;
  return !/\b(request|op|input|interpretation|confidence|source|model|note|prompt|undefined|null|NaN|type|nookwright|schema|zod|expected|invalid|string|number|object)\b/i.test(r);
}

export const NO_READY_TEXT = 'Der Editor hat die Beschreibung nicht übernommen. Füge sie dort unter „Beschreibe dein Gebäude“ ein.';

/**
 * Brücke zum Editor-iframe. `origin`: eigener Ursprung (`location.origin`; `'null'` bei Sandbox/file:// → nie senden,
 * nie annehmen); `frameWindow`: contentWindow des Editor-iframes oder undefined; `notify`: Hinweis für die Nutzerin.
 * @param {{ origin: string, frameWindow: () => ({ postMessage: (msg: unknown, origin: string) => void } | undefined),
 *   notify?: (text: string) => void, setTimer?: (f: () => void, ms: number) => any, clearTimer?: (id: any) => void,
 *   hintMs?: number }} deps
 */
export function createEmbedBridge(deps) {
  const { origin, frameWindow, notify = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, hintMs = READY_HINT_MS } = deps;
  let ready = false;
  let loaded = false;
  /** @type {any} */
  let pending;
  /** @type {any} */
  let timer;
  /** @type {unknown[]} */
  const sent = [];

  const disarm = () => { if (timer !== undefined) clearTimer(timer); timer = undefined; };
  const arm = () => {
    disarm();
    timer = setTimer(() => { timer = undefined; if (pending !== undefined && !ready) notify(NO_READY_TEXT); }, hintMs);
  };
  const flush = () => {
    if (!ready || pending === undefined || origin === 'null') return;
    const win = frameWindow();
    if (!win) return;
    win.postMessage(pending, origin);
    sent.push(pending);
    pending = undefined;
    disarm();
  };

  return {
    get ready() { return ready; },
    get pending() { return pending; },
    /** Gesendete Nachrichten (Tests, Fehlersuche). */
    get sent() { return sent; },
    /**
     * Nur Nachrichten vom eigenen Ursprung **und** aus dem Editor-iframe; liefert, ob die Nachricht verarbeitet wurde.
     * @param {{ origin: string, source: unknown, data: any }} event
     */
    handleMessage(event) {
      const win = frameWindow();
      if (origin === 'null' || event.origin !== origin || win === undefined || event.source !== win) return false;
      const data = event.data;
      if (typeof data !== 'object' || data === null) return false;
      if (data.type === EMBED_READY) { ready = true; flush(); return true; }
      if (data.type === EMBED_REJECTED) { disarm(); notify(rejectedText(data.reason)); return true; }
      return false;
    },
    /**
     * Nachricht (aus `describeMessage`) senden oder bis `ready` vormerken; die jeweils letzte gewinnt.
     * @param {object | undefined} message
     */
    describe(message) {
      if (message === undefined) return;
      pending = message;
      flush();
      if (pending !== undefined && loaded) arm();
    },
    /** Das iframe hat geladen: wartet noch eine Nachricht ohne `ready`, läuft die Frist für den Hinweis. */
    frameLoaded() {
      loaded = true;
      if (pending !== undefined && !ready) arm();
    },
  };
}
