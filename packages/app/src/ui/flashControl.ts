/**
 * Sprung aus der Befehlssuche (W7-G, U8): das Bedienelement mit einer Beschriftung finden, sichtbar scrollen,
 * fokussieren und kurz hervorheben. DOM-Hilfe der Oberfläche (die Auswahl des Orts macht die App vorher).
 */

const INTERACTIVE = 'button, select, input, textarea, summary, a[href], [role="menuitem"], [role="tab"], [role="slider"]';
const ANY = `${INTERACTIVE}, label, legend, h2, h3, dt, span, p`;
const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Beschriftung, nach der gesucht wird: aus `aria-label="…"` den Wert, Quelltext-Konstanten und leere nicht. */
export function findText(label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  const aria = /aria-label="([^"]+)"/.exec(label);
  if (aria !== null) return aria[1];
  const t = label.replace(/^'|'$/g, '').replace(/\s*\($/, '').replace(/…$/, '').trim();
  return t === '' || /^[A-Z_]+$/.test(t) ? undefined : t;
}

const visible = (el: HTMLElement): boolean => el.getClientRects().length > 0;

/**
 * Sucht unter `root` ein sichtbares Element mit dieser Beschriftung (Text, `aria-label` oder `title`): Bedienelemente
 * vor Beschriftungen, dann das genaueste (kürzester Text). Hebt es hervor; `false`, wenn nichts passt.
 */
export function flashControl(root: ParentNode, text: string): boolean {
  const want = norm(text);
  if (want === '') return false;
  const hits = Array.from(root.querySelectorAll<HTMLElement>(ANY)).filter((el) => {
    if (!visible(el) || el.closest('.palette-backdrop') !== null) return false;
    return norm(el.textContent).includes(want) || norm(el.getAttribute('aria-label')).includes(want) || norm(el.getAttribute('title')).includes(want);
  });
  if (hits.length === 0) return false;
  const rank = (el: HTMLElement): number => (el.matches(INTERACTIVE) ? 0 : el.tagName === 'LABEL' ? 1 : 2);
  // W11-B: Treffer im sichtbaren Text bzw. aria-label vor Treffern nur im Tooltip (Strg+K „Mauer“ hob sonst „Tor“ hervor,
  // dessen Tooltip „Klick auf eine Mauer …“ lautet)
  const inTitleOnly = (el: HTMLElement): number => (norm(el.textContent).includes(want) || norm(el.getAttribute('aria-label')).includes(want) ? 0 : 1);
  hits.sort((a, b) => rank(a) - rank(b) || inTitleOnly(a) - inTitleOnly(b) || norm(a.textContent).length - norm(b.textContent).length);
  const hit = hits[0]!;
  const control = hit.tagName === 'LABEL' ? (hit.querySelector<HTMLElement>(INTERACTIVE) ?? hit) : hit;
  control.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // Beschriftung ohne eigenes Bedienelement (Zeile „Überstand − 1 +“): das Eingabefeld der Zeile bekommt den Fokus
  const field = control.matches(INTERACTIVE) ? control : control.parentElement?.querySelector<HTMLElement>('input, select');
  field?.focus({ preventScroll: true });
  control.classList.add('palette-flash');
  window.setTimeout(() => control.classList.remove('palette-flash'), 1600);
  return true;
}

/** Aufklappmenü mit dieser Knopf-Beschriftung öffnen (falls zu), z. B. „Schnitt“ oder „Ansicht“. */
export function openMenu(root: ParentNode, label: string): boolean {
  const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')).find((b) => norm(b.textContent).startsWith(label) || norm(b.getAttribute('aria-label')) === label);
  if (btn === undefined) return false;
  if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
  return true;
}
