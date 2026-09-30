// Reines Modell des KI-Architekten (ohne DOM): Zustandsautomat mit genau einer Anfrage je Beschreibung, Auswertung der
// Antwort von `/v1/interpret`, Plan-Zeilen mit Namen statt IDs, Quelle in Nutzersprache und die geprüfte Übergabe an
// den Editor. `ki.js` zeichnet nur; getestet in website/test/ki-model.test.ts.
//
// Vertrag der Übergabe (plan/spikes/W1_eine_app.md §3, Gegenseite packages/app/src/embed.ts `parseInterpretation`):
// der Editor verwirft die ganze Nachricht bei jeder Abweichung – darum wird hier vor dem Senden geklemmt und geprüft.

export const PROMPT_LIMIT = 500;
/** Zeitlimit wie im Editor (packages/app/src/nlPrompt.ts INTERPRET_TIMEOUT_MS). */
export const TIMEOUT_MS = 20_000;
/** Relativ zur Seite: die Website liegt am Ursprung des Servers (npm run web). */
export const ENDPOINT = 'v1/interpret';
/**
 * Mindest-Sicherheit für den Bautyp (`confidence.buildingTypeId`); darunter gilt „Kein Bautyp sicher erkannt“ – wie in
 * Engine und Editor. Der Build schreibt `TYPE_CONFIDENCE_MIN` aus `@mcda/engine/intent` nach `ki/vocabulary.json`
 * (`typeConfidenceMin`); dieser Wert gilt nur, wenn die Datei fehlt (Test: gleich der Engine-Konstante).
 */
export const DEFAULT_TYPE_CONFIDENCE_MIN = 0.6;
/** Grenzen der Übergabe, wie `parseInterpretation` im Editor sie prüft. */
export const HANDOFF_LIMITS = Object.freeze({ note: 300, model: 120, op: 64, confidenceFields: 64, confidenceKey: 64 });
const OP_PATTERN = /^[a-z][a-z0-9_]*$/;

export const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPlainObj = (v) => isObj(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

// ---------------------------------------------------------------------------------------------- Werte klemmen

/** Zahl auf 0–1; nicht endlich → undefined. */
export function clamp01(x) {
  return typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : undefined;
}

/**
 * Sicherheiten je Feldpfad: nur endliche Zahlen, auf 0–1 geklemmt, höchstens 64 Felder mit Pfaden ≤ 64 Zeichen.
 * @param {unknown} conf
 * @returns {Record<string, number> | undefined}
 */
export function cleanConfidence(conf) {
  if (!isObj(conf)) return undefined;
  /** @type {Record<string, number>} */
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(conf)) {
    const c = clamp01(v);
    if (c === undefined || k === '' || k.length > HANDOFF_LIMITS.confidenceKey) continue;
    if (n++ >= HANDOFF_LIMITS.confidenceFields) break;
    out[k] = c;
  }
  return n > 0 ? out : undefined;
}

/** Kurzer Text: getrimmt, auf `max` Zeichen gekürzt (mit „…“); leer → undefined. */
export function shortText(v, max) {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t === '') return undefined;
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Beschreibung: getrimmt, höchstens {@link PROMPT_LIMIT} Zeichen; leer → ''. */
export const cleanPrompt = (v) => (typeof v === 'string' ? v.trim().slice(0, PROMPT_LIMIT).trim() : '');

// ---------------------------------------------------------------------------------------------- Antwort auswerten

/** Wartezeit in Sekunden aus `Retry-After`, sonst aus „in 42 s“ der Meldung, sonst 10. */
export function retryAfterSeconds(header, body) {
  const h = Number.parseInt(header ?? '', 10);
  if (Number.isFinite(h) && h > 0) return Math.min(h, 24 * 3600);
  const m = /(\d+)\s*s\b/.exec(Array.isArray(body?.errors) ? String(body.errors[0]) : '');
  return m ? Math.min(Number(m[1]), 24 * 3600) : 10;
}

/**
 * Zustände:
 *   idle    { prompt?, cancelled? }
 *   loading { prompt, t0 }
 *   result  { prompt, request, model?, confidence?, fallback?, ms }
 *   error   { prompt, reason: 'rate' | 'offline' | 'unavailable' | 'timeout' | 'invalid', until?, message? }
 * @typedef {{ kind: string, prompt?: string, [key: string]: any }} KiState
 * `offline` = kein KI-Server (Netzfehler, 404/405 auf Datei-Hosting, 401/403); `unavailable` = Server da, aber das
 * Erkennen geht gerade nicht (5xx, z. B. 503 ohne Konfiguration oder volle Warteschlange).
 */
/**
 * @param {{ status: number, retryAfter: string | null, body: any, prompt: string, ms: number, now: number }} r
 * @returns {KiState}
 */
export function stateFromResponse({ status, retryAfter, body, prompt, ms, now }) {
  if (status === 429) return { kind: 'error', reason: 'rate', prompt, until: now + retryAfterSeconds(retryAfter, body) * 1000 };
  if (status >= 200 && status < 300 && isObj(body) && body.ok === true && isObj(body.request)) {
    const confidence = cleanConfidence(body.confidence);
    return {
      kind: 'result', prompt, ms, request: body.request,
      ...(typeof body.model === 'string' && body.model.trim() !== '' ? { model: body.model.trim() } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(typeof body.fallback === 'string' ? { fallback: body.fallback } : {}),
    };
  }
  if (status === 400 || status === 413 || status === 422) {
    const message = isObj(body) && Array.isArray(body.errors) && body.errors.length > 0 ? String(body.errors[0]).slice(0, 300) : '';
    return { kind: 'error', reason: 'invalid', prompt, message };
  }
  if (status >= 500) return { kind: 'error', reason: 'unavailable', prompt };
  return { kind: 'error', reason: 'offline', prompt };
}

/** Anfrage ohne Antwort: abgebrochen (Nutzer), Zeitlimit oder Netz. */
/**
 * @param {{ cancelled: boolean, timedOut: boolean, prompt: string }} f
 * @returns {KiState}
 */
export function stateFromFailure({ cancelled, timedOut, prompt }) {
  if (cancelled && !timedOut) return { kind: 'idle', prompt, cancelled: true };
  return { kind: 'error', reason: timedOut ? 'timeout' : 'offline', prompt };
}

/** Während einer 429-Wartezeit ist jede neue Anfrage gesperrt. */
export const rateLocked = (state, now) => state.kind === 'error' && state.reason === 'rate' && now < state.until;
/** Ab dieser Wartezeit (Sekunden) gilt die Sperre als „Tageskontingent aufgebraucht“ statt kurzem Warten (R2-04). */
export const LONG_WAIT_S = 120;

/**
 * Wartezeit in Worten: kurz → „42 Sekunden“; lang (ab {@link LONG_WAIT_S}) → Dauer in Minuten bzw. Stunden und Uhrzeit,
 * ab der es wieder geht (Ortszeit), z. B. „etwa 5 Stunden (ab 21:30 Uhr)“.
 * @param {number} leftS
 * @param {number} now  Zeitpunkt in ms
 * @returns {{ long: boolean, text: string }}
 */
export function waitText(leftS, now) {
  if (leftS < LONG_WAIT_S) return { long: false, text: `${leftS} ${leftS === 1 ? 'Sekunde' : 'Sekunden'}` };
  const at = new Date(now + leftS * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const min = Math.ceil(leftS / 60);
  const dur = min < 90 ? `${min} Minuten` : `${Math.round(min / 60)} Stunden`;
  return { long: true, text: `etwa ${dur} (ab ${at} Uhr)` };
}

/** Restliche Wartezeit in ganzen Sekunden (0 = frei). */
export const secondsLeft = (state, now) => (state.kind === 'error' && state.reason === 'rate' ? Math.max(0, Math.ceil((state.until - now) / 1000)) : 0);

// ---------------------------------------------------------------------------------------------- Zustandsautomat

/**
 * Steuerung mit genau einer Anfrage je Beschreibung. Alle Einstiege (Enter, Knopf, Beispiel, Startseite, „Nochmal“)
 * rufen `interpret`; eine neue Anfrage überholt eine laufende (die alte wird abgebrochen), während einer 429-Wartezeit
 * wird nichts gesendet. Abhängigkeiten sind injiziert (Tests: Attrappen).
 */
/**
 * @param {{ fetch: (url: string, init: RequestInit) => Promise<any>, now?: () => number, clock?: () => number,
 *   setTimer?: (f: () => void, ms: number) => any, clearTimer?: (id: any) => void, timeoutMs?: number, endpoint?: string,
 *   onChange?: (state: KiState) => void }} deps
 */
export function createKiController({
  fetch: doFetch, now = () => Date.now(), clock = () => now(), setTimer = setTimeout, clearTimer = clearTimeout,
  timeoutMs = TIMEOUT_MS, endpoint = ENDPOINT, onChange = () => {},
}) {
  /** @type {KiState} */
  let state = { kind: 'idle' };
  /** @type {AbortController | undefined} */
  let ctrl;
  /** @type {string | undefined} */
  let lastModel;
  const set = (next) => {
    state = next;
    if (next.kind === 'result') lastModel = next.model ?? 'local';
    onChange(state);
  };
  return {
    /** @returns {KiState} */
    get state() { return state; },
    /** Modell der letzten Antwort (`local`, `typesafe/jev-…`), vorher undefined – für die Lade-Überschrift. */
    get lastModel() { return lastModel; },
    /** Liefert 'sent' | 'empty' | 'locked' | 'superseded' | 'done'. */
    async interpret(prompt) {
      const text = cleanPrompt(prompt);
      if (text === '') return 'empty';
      if (rateLocked(state, now())) {
        // nichts senden; die neueste Beschreibung merken, damit „Nochmal senden“ sie später schickt
        set({ ...state, prompt: text });
        return 'locked';
      }
      ctrl?.abort();
      const mine = new AbortController();
      ctrl = mine;
      let timedOut = false;
      const timer = setTimer(() => { timedOut = true; mine.abort(); }, timeoutMs);
      const t0 = clock();
      set({ kind: 'loading', prompt: text, t0 });
      let next;
      try {
        const res = await doFetch(endpoint, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: text }), signal: mine.signal,
        });
        const body = await res.json().catch(() => undefined);
        next = stateFromResponse({
          status: res.status, retryAfter: res.headers?.get?.('retry-after') ?? null, body, prompt: text, ms: Math.round(clock() - t0), now: now(),
        });
      } catch {
        next = stateFromFailure({ cancelled: mine.signal.aborted, timedOut, prompt: text });
      } finally {
        clearTimer(timer);
      }
      if (ctrl !== mine) return 'superseded';
      ctrl = undefined;
      set(next);
      return 'done';
    },
    /** Laufende Anfrage abbrechen (→ leer mit Hinweis „Abgebrochen“). */
    cancel() { ctrl?.abort(); },
  };
}

// ---------------------------------------------------------------------------------------------- Plan lesen

/** Eingabe eines Bautyp-Aufrufs (wie `typeInput` in packages/app/src/nlPrompt.ts), sonst undefined. */
export function typeInput(req) {
  const input = isObj(req?.input) ? req.input : undefined;
  if (input === undefined) return undefined;
  if (req.op === 'building_generate' || req.op === 'building_propose') return input;
  if (req.op === 'project_create' && isObj(input.buildingType)) {
    const { buildingType, surroundings, ...rest } = input;
    return { ...rest, ...buildingType, ...(surroundings !== undefined ? { surroundings } : {}) };
  }
  return undefined;
}

/**
 * Lagen, die der Generator heute baut – `BUILDABLE_SETTINGS` aus `@mcda/pipeline`, vom Build ins Vokabular geschrieben;
 * ohne Vokabular derselbe Stand (Test: gleich der Pipeline-Konstante).
 */
export const DEFAULT_BUILDABLE_SETTINGS = Object.freeze(['ground', 'buried']);
/** @param {any} vocab @returns {readonly string[]} */
export const buildableSettings = (vocab) => (Array.isArray(vocab?.buildableSettings) ? vocab.buildableSettings : DEFAULT_BUILDABLE_SETTINGS);

/** Schwelle aus dem Vokabular (vom Build aus der Engine), sonst {@link DEFAULT_TYPE_CONFIDENCE_MIN}. */
export const typeConfidenceMin = (vocab) => {
  const v = clamp01(vocab?.typeConfidenceMin);
  return v ?? DEFAULT_TYPE_CONFIDENCE_MIN;
};

/**
 * Plan oder „Kein Bautyp erkannt“: andere Operation (`op`), Bautyp unter der Schwelle (`uncertain`) – dann gibt es keinen
 * Primärknopf mit einem falschen Plan.
 */
/**
 * @param {KiState} st
 * @param {any} vocab
 * @returns {{ kind: 'plan' | 'notype', reason?: 'op' | 'uncertain', typeId?: string, input?: any, confidence?: number }}
 */
export function typeDecision(st, vocab) {
  const input = typeInput(st.request);
  const typeId = input?.buildingTypeId;
  if (input === undefined || typeof typeId !== 'string' || typeId === '') return { kind: 'notype', reason: 'op' };
  const c = st.confidence?.buildingTypeId;
  if (typeof c === 'number' && c < typeConfidenceMin(vocab)) return { kind: 'notype', reason: 'uncertain', typeId, confidence: c };
  return { kind: 'plan', typeId, input };
}

/** Blätter eines Objekts als Pfad → Wert („shell.roof“ → „hip“). */
function leaves(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix === '' ? k : `${prefix}.${k}`;
    if (isObj(v) && Object.keys(v).length > 0) leaves(v, path, out);
    else if (!isObj(v)) out.set(path, v);
  }
  return out;
}

export const OP_LABELS = {
  rooms_generate: 'ein Haus aus einzeln angegebenen Räumen',
  catalog_describe: 'eine Frage nach dem Katalog',
  catalog_list: 'eine Frage nach dem Katalog',
  catalog_get: 'eine Frage nach dem Katalog',
  roomtype_classify: 'die Beschreibung eines einzelnen Raums',
  project_create: 'ein leeres Projekt',
};
const EXTRA_LABELS = { count: 'Vorschläge', name: 'Projektname' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const typeName = (vocab, id) => vocab?.buildingTypes?.[id]?.name ?? id;
const option = (vocab, path, value) => vocab?.fields?.[path]?.options?.[String(value)];
const topic = (vocab, path) => vocab?.fields?.[path]?.topic || path;

/** Sicherheitswerte nur von einem Modell; die lokale Erkennung liefert höchstens den Bautyp (für die Schwelle). */
export const showsConfidence = (st) => st.confidence !== undefined && st.model !== undefined && st.model !== 'local';

/** Zeilen der Plan-Karte in fester Reihenfolge; jede nennt die Feldpfade, deren Sicherheit sie zeigt. */
export function planRows(input, st, vocab) {
  const all = leaves(input);
  const used = new Set();
  const get = (p) => { used.add(p); return all.get(p); };
  const rows = [];
  const add = (label, value, paths, sub, pending) => {
    if (value !== undefined) rows.push({ label, value, paths, ...(sub ? { sub } : {}), ...(pending ? { pending: true } : {}) });
  };

  const typeId = get('buildingTypeId');
  if (typeId !== undefined) {
    // Unsichere Bautypen kommen hier nicht an (typeDecision → „Kein Bautyp sicher erkannt“); ohne Sicherheitswert
    // (Chat-Modelle) gilt der Bautyp wie genannt
    add('Bautyp', typeName(vocab, typeId), ['buildingTypeId']);
  }
  const size = get('size');
  if (size !== undefined) {
    const f = vocab?.buildingTypes?.[typeId]?.sizes?.[size];
    const floors = f ? (f[0] === f[1] ? plural(f[0], 'Etage', 'Etagen') : `${f[0]}–${f[1]} Etagen`) : undefined;
    add('Größe', `${option(vocab, 'size', size) ?? size} (${size})`, ['size'], floors);
  }
  const floors = get('floors');
  if (typeof floors === 'number') add('Etagen', plural(floors, 'Etage', 'Etagen'), ['floors']);
  const theme = get('themeId');
  if (theme !== undefined) add('Stil', vocab?.themes?.[theme] ?? theme, ['themeId']);
  const palette = get('paletteId');
  if (palette !== undefined) add('Farbpalette', vocab?.palettes?.[palette] ?? palette, ['paletteId']);
  const front = get('front');
  if (front !== undefined) add('Eingang', `nach ${option(vocab, 'front', front) ?? front}`, ['front']);
  const roof = get('shell.roof');
  if (roof !== undefined) add('Dach', option(vocab, 'shell.roof', roof) ?? roof, ['shell.roof']);
  const pitch = get('shell.roofDetail.pitch');
  if (pitch !== undefined) add('Dachneigung', option(vocab, 'shell.roofDetail.pitch', pitch) ?? pitch, ['shell.roofDetail.pitch']);
  const kind = get('setting.kind');
  if (kind !== undefined) {
    const sf = get('setting.front'), h = get('setting.height'), cover = get('setting.cover');
    const sub = [sf !== undefined ? `sichtbare Seite: ${option(vocab, 'setting.front', sf) ?? sf}` : '', h !== undefined ? `Höhe ${h}` : '', cover !== undefined ? `${cover} Erdlagen darüber` : '']
      .filter(Boolean).join(' · ');
    // Lagen außerhalb von BUILDABLE_SETTINGS stehen im Vertrag, werden aber noch ebenerdig gebaut (R2-02)
    const pending = !buildableSettings(vocab).includes(String(kind));
    add('Lage', option(vocab, 'setting.kind', kind) ?? kind, ['setting.kind', 'setting.front'], pending ? 'wird noch nicht gebaut – der Generator baut vorerst ebenerdig' : sub || undefined, pending);
  }
  const extOn = get('exterior.enabled'), density = get('exterior.density');
  if (extOn === false) add('Außen-Deko', 'keine', ['exterior.enabled']);
  else if (density !== undefined) add('Außen-Deko', option(vocab, 'exterior.density', density) ?? String(density), ['exterior.density']);
  else if (extOn === true) add('Außen-Deko', 'an', ['exterior.enabled']);
  const surroundings = get('surroundings');
  if (surroundings === false) add('Gelände', 'ohne, nur das Gebäude', ['surroundings']);
  else if (surroundings === true) add('Gelände', 'mit Garten und Bauwerken', ['surroundings']);
  const story = get('storyState');
  if (story !== undefined) add('Zustand', option(vocab, 'storyState', story) ? `${story} (${option(vocab, 'storyState', story)})` : String(story), ['storyState']);
  const seed = get('seed');
  if (seed !== undefined) add('Seed', String(seed), ['seed'], 'gleicher Seed, gleicher Bau');
  const reroll = get('rerollCount');
  if (typeof reroll === 'number' && reroll > 0) add('Variante', String(reroll), ['rerollCount']);
  const version = get('targetVersion');
  if (version !== undefined) add('Version', `Java ${version}`, ['targetVersion']);
  const format = get('format');
  if (format !== undefined) add('Exportformat', `.${format}`, ['format'], option(vocab, 'format', format));
  for (const [path, v] of all) {
    if (used.has(path)) continue;
    const text = option(vocab, path, v) ?? (typeof v === 'boolean' ? (v ? 'ja' : 'nein') : Array.isArray(v) ? v.join(', ') : String(v));
    add(EXTRA_LABELS[path] ?? topic(vocab, path), text, [path]);
  }
  return rows;
}

/**
 * Sicherheit einer Zeile: kleinste der vorhandenen Feldpfade (0–1); 'filled' = aus dem lokalen Klassifikator (Modell
 * ließ offen oder wurde überstimmt, Standard `local-first`).
 */
/**
 * @param {{ paths: string[], [key: string]: unknown }} row
 * @param {Record<string, unknown> | undefined} confidence
 * @returns {number | 'filled' | undefined}
 */
export function rowConfidence(row, confidence) {
  if (confidence === undefined) return undefined;
  const values = row.paths.map((p) => clamp01(confidence[p])).filter((v) => v !== undefined);
  return values.length > 0 ? Math.min(...values) : 'filled';
}

/** Prozent für die Anzeige: 0–100, nie darüber. */
export const percent = (c) => Math.round((clamp01(c) ?? 0) * 100);

// ---------------------------------------------------------------------------------------------- Texte

/** Quelle in Nutzersprache: Badge und Hinweis (keine HTTP-Codes, keine rohen Fehlermeldungen). */
/**
 * @param {{ model?: string, fallback?: string }} st
 * @returns {{ kind: string, badge: string, note?: string, title?: string }}
 */
export function sourceOf(st) {
  const m = st.model;
  if (m === undefined || m === 'local') {
    if (st.fallback !== undefined) {
      const r = st.fallback.toLowerCase();
      const why = /zeit|timeout|abort/.test(r) ? 'hat nicht rechtzeitig geantwortet'
        : /ungültig|invalid|operation/.test(r) ? 'lieferte keinen verwertbaren Plan' : 'war gerade nicht erreichbar';
      return { kind: 'local', badge: 'lokal erkannt', note: `Das Entscheidungsmodell ${why}. Der Server hat deine Beschreibung deshalb lokal erkannt (anhand von Schlüsselwörtern).` };
    }
    return { kind: 'local', badge: 'lokal erkannt', note: 'Auf diesem Server ist kein Sprachmodell eingerichtet. Erkannt mit dem lokalen Klassifikator (anhand von Schlüsselwörtern).' };
  }
  const short = m.replace(/-\d{8}$/, '');
  if (/jev/i.test(m)) return { kind: 'jev', badge: `JEV · ${short}`, title: m };
  return { kind: 'model', badge: `KI · ${short}`, title: m };
}

/**
 * Überschrift beim Laden: „JEV liest …“ nur, wenn die letzte Antwort von JEV kam; sonst neutral.
 * @param {string | undefined} lastModel
 */
export function loadingTitle(lastModel) {
  if (typeof lastModel === 'string' && /jev/i.test(lastModel)) return 'JEV liest deine Beschreibung …';
  if (typeof lastModel === 'string' && lastModel !== 'local') return 'Das Modell liest deine Beschreibung …';
  return 'Deine Beschreibung wird gelesen …';
}

/**
 * Ablehnung (400) in Nutzersprache: nie der rohe Text des Servers (oft englische Validierung). Nennt die Meldung ein
 * Feld („input.floors: …“), wird dessen Name aus dem Vokabular genannt.
 */
/**
 * @param {unknown} message
 * @param {any} vocab
 */
export function invalidText(message, vocab) {
  const m = /^(?:input\.)?([A-Za-z][\w.]*)\s*:/.exec(String(message ?? '').trim());
  const path = m?.[1];
  if (path === 'buildingTypeId') return 'Diese Gebäudeart kennt der Generator nicht.';
  const name = path !== undefined ? FIELD_NAMES[path] ?? vocab?.fields?.[path]?.topic : undefined;
  if (name) return `Die Angabe „${name}“ liegt außerhalb dessen, was der Generator bauen kann.`;
  return 'Mindestens eine Angabe liegt außerhalb dessen, was der Generator bauen kann.';
}

/** Kurze Namen der Felder wie auf der Plan-Karte (sonst das Thema aus dem Schema). */
const FIELD_NAMES = {
  size: 'Größe', floors: 'Etagen', themeId: 'Stil', paletteId: 'Farbpalette', front: 'Eingang', 'shell.roof': 'Dach',
  'shell.roofDetail.pitch': 'Dachneigung', 'setting.kind': 'Lage', 'exterior.density': 'Außen-Deko', surroundings: 'Gelände',
  storyState: 'Zustand', seed: 'Seed', rerollCount: 'Variante', targetVersion: 'Version', format: 'Exportformat',
};

// ---------------------------------------------------------------------------------------------- Übergabe

/**
 * Erkennung für den Editor im Vertragsformat `{ source: 'server', request: { op, input }, model?, confidence?, note? }`,
 * geklemmt und geprüft wie `parseInterpretation` im Editor. Ungültige Operation → undefined (dann nur der Text).
 */
/**
 * @param {KiState} st
 * @returns {{ source: 'server', request: { op: string, input: object }, model?: string, confidence?: Record<string, number>, note?: string } | undefined}
 */
export function interpretationOf(st) {
  const req = st.request;
  if (!isPlainObj(req) || typeof req.op !== 'string' || req.op.length > HANDOFF_LIMITS.op || !OP_PATTERN.test(req.op) || !isPlainObj(req.input)) return undefined;
  const model = shortText(st.model, HANDOFF_LIMITS.model);
  const confidence = cleanConfidence(st.confidence);
  const note = shortText(sourceOf(st).note, HANDOFF_LIMITS.note);
  return {
    source: 'server',
    request: { op: req.op, input: req.input },
    ...(model !== undefined ? { model } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

/** Nachricht `nookwright:describe` (Text geprüft, Erkennung optional); leerer Text → undefined. */
/**
 * @param {unknown} prompt
 * @param {object | undefined} interpretation
 */
export function describeMessage(prompt, interpretation) {
  const text = cleanPrompt(prompt);
  if (text === '') return undefined;
  return { type: 'nookwright:describe', prompt: text, ...(interpretation !== undefined ? { interpretation } : {}) };
}
