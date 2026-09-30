/**
 * Einbettungs-Protokoll Website ⇄ Editor (W1, Vertrag in `plan/spikes/W1_eine_app.md` §3, Bericht
 * `plan/spikes/W1C_editor.md`). Rein und testbar: Fenster, Ursprung und Nachrichten werden übergeben; die Verdrahtung
 * (Listener, `postMessage`, Assistent öffnen) steht in `App.tsx`.
 *
 * - URL `editor/index.html?embed=1` → eingebetteter Modus (Markenzeile kompakt, die Leiste der Website liegt darüber).
 * - URL `?describe=<Text>` (Deep-Link) → wirkt wie `nookwright:describe` ohne `interpretation`.
 * - Editor → Seite: `{ type: 'nookwright:ready' }`, sobald Beschreibungen angenommen werden – nur im iframe und nur an
 *   den eigenen Ursprung.
 * - Seite → Editor: `{ type: 'nookwright:describe', prompt, interpretation? }` – angenommen nur, wenn
 *   `event.origin === location.origin` und `event.source === window.parent`; die Form wird streng geprüft. Mit
 *   `interpretation` (Antwort von `/v1/interpret`) übernimmt der Assistent den Plan **ohne zweiten Modellaufruf**.
 * - Editor → Seite: `{ type: 'nookwright:rejected', reason }`, wenn eine `nookwright:describe`-Nachricht des
 *   Elternfensters die Form verfehlt (Review R1-08). Nachrichten fremder Absender bleiben unbeantwortet.
 */
import type { EngineRequest } from '@mcda/engine/intent';
import type { Interpretation } from './nlPrompt.js';

/** Nachricht Editor → Seite: Beschreibungen werden ab jetzt angenommen. */
export const EMBED_READY = 'nookwright:ready';
/** Nachricht Seite → Editor: Beschreibung (und optional die fertige Erkennung) in den Assistenten. */
export const EMBED_DESCRIBE = 'nookwright:describe';
/** Nachricht Editor → Seite: eine `nookwright:describe`-Nachricht wurde verworfen (mit Grund). */
export const EMBED_REJECTED = 'nookwright:rejected';

/** Längste angenommene Beschreibung – wie das Eingabefeld des Assistenten (`maxLength`). */
export const MAX_PROMPT_LENGTH = 500;
/** Grenzen der übrigen Textfelder einer Erkennung (Anzeige in einer Zeile bzw. im Tooltip). */
const MAX_NOTE_LENGTH = 300;
const MAX_MODEL_LENGTH = 120;
const MAX_OP_LENGTH = 64;
/** Höchstzahl Konfidenz-Felder (JEV liefert je übernommenem Feld einen Wert, heute < 20). */
const MAX_CONFIDENCE_FIELDS = 64;

export interface EmbedOptions {
  /** `?embed=1`: im iframe der Website. */
  readonly embedded: boolean;
  /** `?describe=<Text>`: Beschreibung beim Start (gültig, getrimmt). */
  readonly describe?: string;
}

/** Nachricht `nookwright:describe`, geprüft. */
export interface DescribeCommand {
  readonly prompt: string;
  /** Fertige Erkennung der Website (`/v1/interpret`); fehlt = der Editor erkennt selbst (`describeBuilding`). */
  readonly interpretation?: Interpretation;
}

/** Mindestform eines Fensters für das Protokoll (Tests: Attrappe). */
export interface WindowLike {
  readonly parent: unknown;
  readonly location: { readonly origin: string };
}

/** Mindestform eines `MessageEvent`. */
export interface MessageLike {
  readonly origin: string;
  readonly source: unknown;
  readonly data: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> => isObject(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** Beschreibung prüfen: Text, nicht leer, höchstens {@link MAX_PROMPT_LENGTH} Zeichen (nach dem Trimmen). */
export function cleanPrompt(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' || t.length > MAX_PROMPT_LENGTH ? undefined : t;
}

/** Optionen aus der Adresse (`location.search`). */
export function embedOptions(search: string): EmbedOptions {
  const q = new URLSearchParams(search);
  const describe = cleanPrompt(q.get('describe'));
  return { embedded: q.get('embed') === '1', ...(describe !== undefined ? { describe } : {}) };
}

/** Optionaler kurzer Text: fehlt → `undefined`; falscher Typ oder zu lang → ungültig (`false`). */
function optionalText(v: unknown, max: number): string | undefined | false {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length > max) return false;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** Ergebnis einer Prüfung: Wert oder Grund der Ablehnung (Text für `nookwright:rejected`). */
type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };
const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
const no = <T>(reason: string): Checked<T> => ({ ok: false, reason });

/**
 * Gründe der Ablehnung (Nachricht `nookwright:rejected`): kurze Sätze in Nutzersprache für den Hinweis auf der Website
 * (W1-G, Review R2-05) – ohne Vertragsdetails wie Feldnamen (`request.op`, `source`). Die Website zeigt sie nach
 * „Grund:“ (höchstens 160 Zeichen, siehe `website/js/embed-model.js`). Welche Prüfung scheiterte, sagt der Schlüssel.
 */
export const REJECT_REASONS = {
  prompt: 'Die Beschreibung ist leer.',
  promptLength: `Die Beschreibung ist zu lang (höchstens ${MAX_PROMPT_LENGTH} Zeichen).`,
  interpretation: 'Die Erkennung des KI-Architekten war unvollständig.',
  source: 'Die Erkennung kam aus einer unbekannten Quelle.',
  op: 'Die Erkennung nannte keinen gültigen Bauauftrag.',
  input: 'Die Erkennung enthielt keine lesbaren Angaben zum Gebäude.',
  model: 'Der Name des Sprachmodells war ungültig.',
  note: 'Der Hinweis zur Erkennung war zu lang oder ungültig.',
  confidence: 'Die Sicherheitswerte der Erkennung waren ungültig.',
} as const;

function checkInterpretation(v: unknown): Checked<Interpretation> {
  if (!isPlainObject(v)) return no(REJECT_REASONS.interpretation);
  const source = v['source'];
  if (source !== 'server' && source !== 'local') return no(REJECT_REASONS.source);
  const req = v['request'];
  if (!isPlainObject(req)) return no(REJECT_REASONS.op);
  const op = req['op'];
  if (typeof op !== 'string' || op === '' || op.length > MAX_OP_LENGTH || !/^[a-z][a-z0-9_]*$/.test(op)) return no(REJECT_REASONS.op);
  if (!isPlainObject(req['input'])) return no(REJECT_REASONS.input);
  const model = optionalText(v['model'], MAX_MODEL_LENGTH);
  if (model === false) return no(REJECT_REASONS.model);
  const note = optionalText(v['note'], MAX_NOTE_LENGTH);
  if (note === false) return no(REJECT_REASONS.note);
  let confidence: Record<string, number> | undefined;
  const conf = v['confidence'];
  if (conf !== undefined) {
    if (!isPlainObject(conf)) return no(REJECT_REASONS.confidence);
    const entries = Object.entries(conf);
    if (entries.length > MAX_CONFIDENCE_FIELDS) return no(REJECT_REASONS.confidence);
    for (const [k, x] of entries) {
      if (k.length > MAX_OP_LENGTH || typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) return no(REJECT_REASONS.confidence);
    }
    confidence = Object.fromEntries(entries) as Record<string, number>;
  }
  return ok({
    source,
    request: { op, input: req['input'] } as unknown as EngineRequest,
    ...(model !== undefined ? { model } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  });
}

/**
 * Erkennung der Website prüfen: `{ source: 'server' | 'local', request: { op: string, input: object }, model?,
 * confidence?: { Feld: 0–1 }, note? }`. Jede Abweichung → `undefined` (die ganze Nachricht wird verworfen).
 * Weitere Felder der Serverantwort (`ok`, `interpretMs` …) werden ignoriert.
 */
export function parseInterpretation(v: unknown): Interpretation | undefined {
  const r = checkInterpretation(v);
  return r.ok ? r.value : undefined;
}

/** `nookwright:describe` prüfen: Befehl oder Grund der Ablehnung; `undefined`, wenn es keine solche Nachricht ist. */
function checkDescribe(data: unknown): Checked<DescribeCommand> | undefined {
  if (!isPlainObject(data) || data['type'] !== EMBED_DESCRIBE) return undefined;
  const raw = data['prompt'];
  const prompt = cleanPrompt(raw);
  if (prompt === undefined) return no(typeof raw === 'string' && raw.trim().length > MAX_PROMPT_LENGTH ? REJECT_REASONS.promptLength : REJECT_REASONS.prompt);
  if (data['interpretation'] === undefined) return ok({ prompt });
  const it = checkInterpretation(data['interpretation']);
  return it.ok ? ok({ prompt, interpretation: it.value }) : no(it.reason);
}

/** Nutzdaten einer `nookwright:describe`-Nachricht prüfen (ohne Absender – dafür {@link acceptDescribe}). */
export function parseDescribe(data: unknown): DescribeCommand | undefined {
  const r = checkDescribe(data);
  return r?.ok === true ? r.value : undefined;
}

/**
 * Eingehende Nachricht einordnen:
 * - `ignore`: nicht vom **eigenen Ursprung** (nie `null`: `file://`, Sandbox) bzw. nicht vom **Elternfenster**, oder
 *   keine `nookwright:describe`-Nachricht (andere Werkzeuge schicken auch Nachrichten) – keine Antwort.
 * - `reject`: `nookwright:describe` vom Elternfenster, aber falsche Form → Antwort `nookwright:rejected` mit Grund.
 * - `accept`: geprüfter Befehl.
 *
 * Im iframe ist das Elternfenster die Website; ohne iframe ist es das Fenster selbst – so lässt sich das Protokoll
 * auch ohne Website mit `window.postMessage` prüfen.
 */
export function receiveDescribe(
  event: MessageLike, self: WindowLike,
): { readonly kind: 'accept'; readonly command: DescribeCommand } | { readonly kind: 'reject'; readonly reason: string } | { readonly kind: 'ignore' } {
  const origin = self.location.origin;
  if (origin === 'null' || event.origin !== origin || event.source !== self.parent) return { kind: 'ignore' };
  const r = checkDescribe(event.data);
  if (r === undefined) return { kind: 'ignore' };
  return r.ok ? { kind: 'accept', command: r.value } : { kind: 'reject', reason: r.reason };
}

/** Nachricht annehmen? Wie {@link receiveDescribe}, aber nur der geprüfte Befehl (sonst `undefined`). */
export function acceptDescribe(event: MessageLike, self: WindowLike): DescribeCommand | undefined {
  const r = receiveDescribe(event, self);
  return r.kind === 'accept' ? r.command : undefined;
}

/** Nachricht „bereit“. */
export function readyMessage(): { readonly type: typeof EMBED_READY } {
  return { type: EMBED_READY };
}

/** Nachricht „abgelehnt“ (Editor → Seite): die Beschreibung kam an, hatte aber nicht die verabredete Form. */
export function rejectedMessage(reason: string): { readonly type: typeof EMBED_REJECTED; readonly reason: string } {
  return { type: EMBED_REJECTED, reason };
}

/** Elternfenster zum Antworten: nur im iframe (`parent !== self`) und nie bei Ursprung `null`. */
function replyTarget(self: WindowLike): { postMessage: (message: unknown, targetOrigin: string) => void } | undefined {
  const parent = self.parent as { postMessage?: (message: unknown, targetOrigin: string) => void } | null | undefined;
  if (parent === self || parent === null || parent === undefined || typeof parent.postMessage !== 'function' || self.location.origin === 'null') return undefined;
  return parent as { postMessage: (message: unknown, targetOrigin: string) => void };
}

/**
 * „Bereit“ an die Website melden – nur im iframe (`parent !== self`) und nur an den eigenen Ursprung. Liefert, ob
 * gesendet wurde.
 */
export function announceReady(self: WindowLike): boolean {
  const parent = replyTarget(self);
  if (parent === undefined) return false;
  parent.postMessage(readyMessage(), self.location.origin);
  return true;
}

/**
 * „Abgelehnt“ an die Website melden (Review R1-08) – wie {@link announceReady} nur im iframe und nur an den eigenen
 * Ursprung. Die Website zeigt dazu einen Hinweis. Liefert, ob gesendet wurde.
 */
export function announceRejected(self: WindowLike, reason: string): boolean {
  const parent = replyTarget(self);
  if (parent === undefined) return false;
  parent.postMessage(rejectedMessage(reason), self.location.origin);
  return true;
}
