/**
 * Use Case „Beschreibe dein Gebäude“ (C3): Freitext → Engine-Anfrage → Vorschlag im Bautyp-Assistenten. Übernommen
 * wird über denselben Weg wie eine Auswahl von Hand (`TypeParams` → `proposal` → `typeSession`).
 *
 * Erkennung: zuerst der Engine-Server (`POST /v1/interpret`, dort Modell per OpenRouter; der API-Schlüssel bleibt im
 * Server), sonst der lokale Klassifikator der Engine direkt im Browser (`@mcda/engine/intent`, rein, ohne Netz).
 * Rein bis auf den injizierten `fetch` (Browser: `window.fetch`, Tests: Attrappe).
 */
import { defaultSize, type PlanShell } from '@mcda/archetype';
import { STORY_STATES, type BuildingSetting, type RoofStyle, type StoryState } from '@mcda/blueprint';
import type { BuildingSizeClass, BuildingTypeCatalog, BuildingTypeDef } from '@mcda/catalog';
import type { HorizontalDir } from '@mcda/core';
import { TYPE_CONFIDENCE_MIN, classifyLocal, type EngineRequest, type Vocabulary } from '@mcda/engine/intent';
import { settingBuildable } from '@mcda/pipeline';
import { FUNCTION_LEVEL_OPTIONS, ROOF_NAMES, defaultParams, floorChoices, hasFunctionRooms, isFixed, sizesOf, withSize, type TypeParams } from './buildingTypes.js';
import type { ShellStyle } from './usecases.js';

/** Pfad des Vite-Proxys zum Engine-Server (vite.config.ts); ohne `VITE_ENGINE_URL` der Standard. */
export const ENGINE_PROXY_PATH = '/engine';
/** Zeitlimit für den Server (Modell braucht 1–3 s, Reserve für einen Wiederholungsversuch). */
export const INTERPRET_TIMEOUT_MS = 20_000;

/**
 * Basis-URL des Engine-Servers: `VITE_ENGINE_URL` oder der Proxy der App. Absolut (`http://127.0.0.1:8787`) oder
 * **relativ zur Seite**: Der gebaute Editor liegt unter `/editor/` und bekommt `VITE_ENGINE_URL=..` – `fetch` löst
 * `../v1/interpret` dann gegen `/editor/index.html` zu `/v1/interpret` desselben Ursprungs auf (W1, Abnahme A3).
 */
export function engineBaseUrl(env: { readonly VITE_ENGINE_URL?: string | undefined }): string {
  const url = env.VITE_ENGINE_URL?.trim();
  return url !== undefined && url !== '' ? url.replace(/\/+$/, '') : ENGINE_PROXY_PATH;
}

export interface Interpretation {
  /** `server`: Engine-Server (Modell oder dessen lokaler Rückfall); `local`: Klassifikator im Browser. */
  readonly source: 'server' | 'local';
  readonly request: EngineRequest;
  /** Modell-ID laut Server (`local`, wenn der Server selbst lokal klassifiziert hat). */
  readonly model?: string;
  /** Hinweis in Nutzersprache (Rückfall und Grund, ohne HTTP-Codes – A3). */
  readonly note?: string;
  /** Technischer Grund des Rückfalls (Statuscode, Servermeldung) – nur für den Tooltip, nie in der Zeile selbst. */
  readonly reason?: string;
  /** Konfidenz je übernommenem Feld laut Server (Entscheidungsmodell JEV; Feldpfad → 0–1). */
  readonly confidence?: Readonly<Record<string, number>>;
  /**
   * W1-G (S2): Sicherheit des lokalen Klassifikators für den Bautyp (`classifyLocal(...).confidence`: 1 = genannt,
   * 0,8 = Kopf eines Kompositums wie „Zwergenfestung“, 0,3 = Standard angenommen). Gesetzt, wenn der Bautyp vom lokalen
   * Klassifikator stammt – im Browser, auf dem Server ohne Modell oder von JEV offen gelassen und lokal ergänzt.
   */
  readonly localConfidence?: number;
  /** Dauer im Browser; fehlt, wenn die Erkennung von außen kam (Website, `nookwright:describe`). */
  readonly ms?: number;
  /**
   * F-JEV-iterativ: Der Server hat den Schalter `ENGINE_NL_ITERATE` an (JEV als Planer und Kritiker) – der Assistent
   * bietet dann „Planen & verbessern“ an ({@link designIterative}). Fehlt, solange der Schalter aus ist.
   */
  readonly iterate?: boolean;
}

/**
 * Hinweise zur Quelle der Erkennung in Nutzersprache (A3: keine rohen HTTP-Codes). „KI-Server“ ist der Engine-Server
 * mit dem Entscheidungsmodell (JEV); „im Browser erkannt“ heißt: lokaler Klassifikator ohne Netz.
 */
export const SOURCE_NOTES = {
  /** Kein Server (statisches Hosting, Proxy ohne Ziel, Netzwerkfehler, 404). */
  unreachable: 'KI-Server nicht erreichbar – im Browser erkannt',
  /** Zeitlimit überschritten. */
  timeout: 'KI-Server antwortet nicht – im Browser erkannt',
  /** Server ohne konfiguriertes Sprachmodell (503). */
  noModel: 'Server ohne Sprachmodell – im Browser erkannt',
  /** Server hat selbst lokal klassifiziert (`model: 'local'`). */
  serverLocal: 'Server ohne Sprachmodell – lokal erkannt',
  /** Modell lieferte nichts Brauchbares, der Server fiel auf seinen Klassifikator zurück (`fallback`). */
  modelFailed: 'Sprachmodell gerade nicht nutzbar – der Server hat lokal erkannt',
  /** Anmeldung fehlt oder ist abgelehnt (401/403). */
  denied: 'KI-Server lässt diese Seite nicht zu – im Browser erkannt',
  /** Rate-Limit (429). */
  busy: 'KI-Server gerade ausgelastet – im Browser erkannt',
  /** Anfrage abgelehnt (400/422 …). */
  rejected: 'KI-Server konnte die Beschreibung nicht verarbeiten – im Browser erkannt',
  /** Serverfehler (5xx außer 503). */
  failed: 'KI-Server gestört – im Browser erkannt',
} as const;

/** HTTP-Status einer abgelehnten Antwort → Hinweis in Nutzersprache. */
function rejectionNote(status: number): string {
  if (status === 404) return SOURCE_NOTES.unreachable;
  if (status === 401 || status === 403) return SOURCE_NOTES.denied;
  if (status === 429) return SOURCE_NOTES.busy;
  if (status === 503) return SOURCE_NOTES.noModel;
  if (status >= 500) return SOURCE_NOTES.failed;
  return SOURCE_NOTES.rejected;
}

/** Modellfamilie für die Anzeige: JEV und Kev beim Namen, alles andere „Sprachmodell“. */
function modelFamily(model: string): string {
  if (/\bjev\b|jev-/i.test(model)) return 'JEV';
  if (/\bkev\b|kev-/i.test(model)) return 'Kev';
  return 'Sprachmodell';
}

/**
 * Zeile „woher kommt der Vorschlag?“ für den Assistenten: „Erkannt mit JEV (typesafe/jev-1.13)“, sonst der Hinweis
 * des Rückfalls. Datumsanhänge der Modell-ID (`-20260917`) entfallen, die Version bleibt.
 */
export function sourceText(it: Pick<Interpretation, 'source' | 'model' | 'note'>): string {
  if (it.note !== undefined && it.note !== '') return it.note;
  if (it.source === 'local') return 'Im Browser erkannt';
  const model = it.model?.trim();
  if (model === undefined || model === '') return 'Vom KI-Server erkannt';
  if (model === 'local') return SOURCE_NOTES.serverLocal;
  return `Erkannt mit ${modelFamily(model)} (${model.replace(/-\d{8}$/, '')})`;
}

export interface DescribeDeps {
  readonly baseUrl: string;
  readonly vocabulary: Vocabulary;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** Zeitquelle (Tests); Standard `performance.now`. */
  readonly now?: () => number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Freitext → Engine-Anfrage. Server nicht erreichbar, abgelehnt oder zu langsam → lokaler Klassifikator mit Hinweis.
 * Wirft nur bei leerem Text.
 */
export async function describeBuilding(prompt: string, deps: DescribeDeps): Promise<Interpretation> {
  const text = prompt.trim();
  if (text === '') throw new Error('Bitte beschreiben, was gebaut werden soll (z. B. „kleine Taverne mit Flachdach“)');
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  const local = (note: string, reason?: string): Interpretation => {
    const r = classifyLocal(text, deps.vocabulary);
    return { source: 'local', request: r.request, localConfidence: r.confidence, note, ...(reason !== undefined ? { reason } : {}), ms: Math.round(now() - t0) };
  };
  const doFetch = deps.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  if (doFetch === undefined) return local(SOURCE_NOTES.unreachable, 'kein fetch im Browser');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? INTERPRET_TIMEOUT_MS);
  try {
    const res = await doFetch(`${deps.baseUrl}/v1/interpret`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: text }), signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => undefined)) as unknown;
    if (!res.ok || !isObject(body) || body['ok'] !== true || !isObject(body['request'])) {
      // Kein JSON: kein Engine-Server dahinter (Vite-Proxy ohne Ziel antwortet selbst mit 5xx, statisches Hosting mit 404)
      if (!isObject(body)) return local(SOURCE_NOTES.unreachable, `HTTP ${res.status} ohne JSON`);
      const why = Array.isArray(body['errors']) && body['errors'].length > 0 ? `: ${String(body['errors'][0])}` : '';
      return local(res.ok ? SOURCE_NOTES.rejected : rejectionNote(res.status), `HTTP ${res.status}${why}`);
    }
    const model = typeof body['model'] === 'string' ? body['model'] : undefined;
    const fallback = typeof body['fallback'] === 'string' ? body['fallback'] : undefined;
    const conf = body['confidence'];
    const confidence = isObject(conf)
      ? Object.fromEntries(Object.entries(conf).filter((e): e is [string, number] => typeof e[1] === 'number'))
      : undefined;
    return withLocalConfidence({
      source: 'server',
      request: body['request'] as unknown as EngineRequest,
      ...(model !== undefined ? { model } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(fallback !== undefined ? { note: SOURCE_NOTES.modelFailed, reason: fallback } : model === 'local' ? { note: SOURCE_NOTES.serverLocal } : {}),
      ...(body['iterate'] === true ? { iterate: true } : {}),
      ms: Math.round(now() - t0),
    }, text, deps.vocabulary);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return local(aborted ? SOURCE_NOTES.timeout : SOURCE_NOTES.unreachable, e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sicherheit des Bautyps: Konfidenz des Felds `buildingTypeId` laut Server (JEV oder – seit W1-G – der lokale
 * Klassifikator des Servers), sonst die des lokalen Klassifikators im Browser. `undefined` = unbekannt (Sprachmodell
 * ohne Konfidenz-Angabe) – dann gilt die Wahl des Modells. „Sicher erkannt“ ab `TYPE_CONFIDENCE_MIN` (@mcda/engine/intent).
 */
export function typeConfidence(it: Pick<Interpretation, 'confidence' | 'localConfidence'>): number | undefined {
  const jev = it.confidence?.['buildingTypeId'];
  return typeof jev === 'number' ? jev : it.localConfidence;
}

/**
 * Ergänzt `localConfidence`, wenn der Bautyp einer Erkennung vom lokalen Klassifikator stammt: Browser, Server ohne
 * Modell (`model: 'local'`), Rückfall des Servers, JEV ohne Antwort zum Bautyp (lokal ergänzt) oder eine Übernahme von
 * der Website ohne Modellangabe. Derselbe Klassifikator läuft im Browser mit demselben Vokabular, das Ergebnis ist also
 * das des Servers. Wählte ein Modell einen anderen Bautyp, sagt die lokale Sicherheit nichts darüber (bleibt offen).
 */
export function withLocalConfidence(it: Interpretation, prompt: string, vocabulary: Vocabulary): Interpretation {
  if (it.localConfidence !== undefined || typeof it.confidence?.['buildingTypeId'] === 'number') return it;
  const fromLocal = it.source === 'local' || it.model === undefined || it.model === 'local' || it.reason !== undefined || it.confidence !== undefined;
  if (!fromLocal || prompt.trim() === '') return it;
  const r = classifyLocal(prompt.trim(), vocabulary);
  const typeOf = (req: EngineRequest): unknown => {
    const input = isObject(req.input) ? req.input : {};
    return isObject(input['buildingType']) ? input['buildingType']['buildingTypeId'] : input['buildingTypeId'];
  };
  return typeOf(r.request) === typeOf(it.request) ? { ...it, localConfidence: r.confidence } : it;
}

/** Konfidenzen für einen Tooltip: „buildingTypeId 1,00 · size 0,97“ (leer ohne Angaben). */
export function confidenceText(confidence: Readonly<Record<string, number>> | undefined): string {
  if (confidence === undefined) return '';
  return Object.entries(confidence).map(([k, v]) => `${k} ${v.toFixed(2).replace('.', ',')}`).join(' · ');
}

// ---------------------------------------------------------------------------------------------- Übernahme

export interface WizardSuggestion {
  readonly def: BuildingTypeDef;
  readonly params: TypeParams;
  /** Seed aus dem Text („seed 7“) → Basis der Vorschläge. */
  readonly seed?: number;
  /** Übernommene Angaben in Worten (für die Statuszeile). */
  readonly applied: readonly string[];
  /** Erkannt, aber im Assistenten nicht einstellbar oder für diesen Bautyp nicht möglich. */
  readonly ignored: readonly string[];
}

/** Nutzersprache wie die Plan-Karte des KI-Architekten (Website, Texte aus dem Engine-Schema): „Eingang nach Osten“. */
const DIR_LABEL: Readonly<Record<HorizontalDir, string>> = { north: 'Norden', east: 'Osten', south: 'Süden', west: 'Westen' };
/** Größen wie die Plan-Karte: „groß (L)“. */
const SIZE_WORDS: Readonly<Record<BuildingSizeClass, string>> = { S: 'klein', M: 'mittel', L: 'groß' };
const SETTING_LABEL: Readonly<Record<string, string>> = {
  ground: 'ebenerdig', buried: 'im Erdhügel', cliff: 'am Hang', carved: 'in den Fels', stilts: 'auf Stelzen', tree: 'im Baum', water: 'am Wasser', underwater: 'unter Wasser',
};
/** Weitere Stil-Angaben einer Anfrage (`shell.*` außer Dachform) in Worten. */
const SHELL_LABEL: Readonly<Record<string, string>> = {
  overhang: 'Dachüberstand', windows: 'Fenster', roofDetail: 'Dach-Details', dormers: 'Gauben', facade: 'Außenprofil', stableCellIds: 'Zell-IDs',
};
const floorsText = (n: number): string => `${n} ${n === 1 ? 'Etage' : 'Etagen'}`;
const sizeText = (size: string): string => (Object.hasOwn(SIZE_WORDS, size) ? `${SIZE_WORDS[size as BuildingSizeClass]} (${size})` : `Größe ${size}`);

/** Beschriftungen aus dem Katalog (Theme-Namen); ohne sie stehen die IDs. */
export interface SuggestionLabels {
  readonly themeName?: ((id: string) => string) | undefined;
}

/** Eingabe eines Bautyp-Aufrufs aus der Anfrage (building_generate, building_propose, project_create mit Bautyp). */
function typeInput(req: EngineRequest): Record<string, unknown> | undefined {
  const input = isObject(req.input) ? req.input : undefined;
  if (input === undefined) return undefined;
  if (req.op === 'building_generate' || req.op === 'building_propose') return input;
  if (req.op === 'project_create' && isObject(input['buildingType'])) {
    return { ...input['buildingType'], ...(input['themeId'] !== undefined ? { themeId: input['themeId'] } : {}), ...(input['seed'] !== undefined ? { seed: input['seed'] } : {}) };
  }
  return undefined;
}

/**
 * Engine-Anfrage → Parameter des Bautyp-Assistenten (ausgehend von dessen Standard für den Bautyp). Nur Werte, die der
 * Assistent für diesen Bautyp anbietet; alles andere landet in `ignored`. `undefined`, wenn die Anfrage keinen
 * bekannten Bautyp nennt (z. B. freie Räume).
 */
export function suggestionFor(
  req: EngineRequest, types: BuildingTypeCatalog, themeIds: readonly string[], currentTheme: string, current: ShellStyle, labels: SuggestionLabels = {},
): WizardSuggestion | undefined {
  const i = typeInput(req);
  const id = i?.['buildingTypeId'];
  if (i === undefined || typeof id !== 'string' || !types.ids().includes(id)) return undefined;
  const def = types.get(id);
  const themeName = labels.themeName ?? ((t: string) => t);
  const applied: string[] = [def.label ?? def.name];
  const ignored: string[] = [];
  let params: TypeParams = defaultParams(def, themeIds, currentTheme, current);
  const size = i['size'];
  if (typeof size === 'string') {
    if (sizesOf(def).includes(size as BuildingSizeClass)) {
      const { floors: _f, ...rest } = params;
      params = { ...rest, size: size as BuildingSizeClass };
      applied.push(sizeText(size));
    } else ignored.push(`${sizeText(size)}${isFixed(def) ? ' – fester Grundriss' : ''}`);
  }
  const floors = i['floors'];
  if (typeof floors === 'number') {
    // W8-D: ohne Größenangabe wählt die Etagenzahl die Größe (wie der Generator, `defaultSize`): „Wachturm, 3 Etagen“ → S
    const bySize = typeof size === 'string' ? undefined : defaultSize(def, floors);
    if (bySize !== undefined && bySize !== params.size && sizesOf(def).includes(bySize)) {
      params = withSize(def, params, bySize);
      applied.push(sizeText(bySize));
    }
    const sized = params.size === undefined ? undefined : def.sizes?.[params.size]?.floors;
    // L3: ein fester Grundriss hat genau seine Etagen – verlangt die Beschreibung genau so viele, ist das erfüllt
    const fixed = def.massing.generator === 'fixed' ? (def.massing.upperFloors ?? 0) + 1 : undefined;
    if (floorChoices(def, params.size).includes(floors)) {
      params = { ...params, floors };
      applied.push(floorsText(floors));
    } else if (sized === floors || fixed === floors) applied.push(floorsText(floors)); // die Größe bzw. Vorlage hat genau so viele
    else ignored.push(`${floorsText(floors)}${fixed !== undefined ? ` – fester Grundriss mit ${floorsText(fixed)}` : ''}`);
  }
  const front = i['front'];
  if (typeof front === 'string' && Object.hasOwn(DIR_LABEL, front)) {
    params = { ...params, front: front as HorizontalDir };
    applied.push(`Eingang nach ${DIR_LABEL[front as HorizontalDir]}`);
  }
  const theme = i['themeId'];
  if (typeof theme === 'string') {
    if (themeIds.includes(theme)) {
      params = { ...params, themeId: theme };
      applied.push(`Stil ${themeName(theme)}`);
    } else ignored.push(`Stil ${theme}`);
  }
  const exterior = i['exterior'];
  if (isObject(exterior)) {
    if (exterior['enabled'] === false) {
      params = { ...params, exterior: false };
      applied.push('ohne Außen-Deko');
    } else {
      params = { ...params, exterior: true };
      if (Object.keys(exterior).some((k) => k !== 'enabled')) ignored.push('Einstellungen der Außen-Deko (im Panel „Außen“ einstellbar)');
    }
  }
  if (i['surroundings'] === false && params.site) {
    params = { ...params, site: false };
    applied.push('ohne Gelände');
  }
  const shell = i['shell'];
  if (isObject(shell) && Object.keys(shell).length > 0) {
    params = { ...params, shell: shell as Partial<PlanShell> };
    const roof = shell['roof'];
    if (typeof roof === 'string') applied.push(ROOF_NAMES[roof as RoofStyle] ?? `Dach ${roof}`);
    const detail = shell['roofDetail'];
    const pitch = isObject(detail) ? detail['pitch'] : undefined;
    if (pitch === 'steep' || pitch === 'low') applied.push(pitch === 'steep' ? 'steiles Dach' : 'flach geneigtes Dach');
    const rest = Object.keys(shell).filter((k) => k !== 'roof' && !(k === 'roofDetail' && isObject(detail) && Object.keys(detail).every((d) => d === 'pitch')));
    if (rest.length > 0) applied.push(rest.map((k) => SHELL_LABEL[k] ?? k).join(', '));
  }
  const setting = i['setting'];
  if (isObject(setting) && typeof setting['kind'] === 'string') {
    const label = SETTING_LABEL[setting['kind']] ?? setting['kind'];
    // S1b: nur Lagen, die die Domäne baut (gemeinsame Regel, @mcda/pipeline); sonst ehrlich „noch nicht baubar“
    if (settingBuildable(setting['kind'])) {
      params = { ...params, setting: setting as unknown as BuildingSetting };
      applied.push(label);
    } else ignored.push(`${label} (noch nicht baubar)`);
  }
  const seed = typeof i['seed'] === 'number' && Number.isInteger(i['seed']) && i['seed'] >= 0 ? i['seed'] : undefined;
  if (seed !== undefined) applied.push(`Seed ${seed}`);
  if (typeof i['format'] === 'string') ignored.push(`Exportformat ${i['format']} (beim Export wählbar)`);
  if (typeof i['targetVersion'] === 'string') ignored.push(`Zielversion ${i['targetVersion']} (im Export-Dialog wählbar)`);
  if (typeof i['rerollCount'] === 'number' && i['rerollCount'] > 0) ignored.push('Variante (im Assistenten: „↻ 3 neue“)');
  // W7-G (nach W7-E): der Zustand wird wie in der Engine gebaut (nur Materialspuren); im Editor unter Haus › Mehr änderbar
  const story = i['storyState'];
  if (typeof story === 'string') {
    if ((STORY_STATES as readonly string[]).includes(story)) {
      params = { ...params, storyState: story as StoryState };
      applied.push(`Zustand ${story}`);
    } else ignored.push(`Zustand ${story}`);
  }
  // W2-1: Funktionsgrad wie in der Engine (`functionLevel`); nur, wo der Bautyp Funktionsräume kennt
  const level = i['functionLevel'];
  if (level === 'some' || level === 'rich') {
    const label = `Funktionsgrad ${FUNCTION_LEVEL_OPTIONS.find((o) => o.id === level)!.label.toLowerCase()}`;
    if (hasFunctionRooms(def)) {
      params = { ...params, functionLevel: level };
      applied.push(label);
    } else ignored.push(`${label} – dieser Bautyp hat keine Funktionsräume`);
  }
  return { def, params, ...(seed !== undefined ? { seed } : {}), applied, ignored };
}

/** Anfang des Hinweises, wenn kein Bautyp sicher erkannt ist (W1-G S2/R1-02; Website und Editor gleich formuliert). */
export const UNCERTAIN_TYPE_TEXT = 'Kein Bautyp sicher erkannt – bitte wähle einen';

/**
 * Was der Assistent aus einer Erkennung macht (W1-G S2/R1-02): `none` – die Anfrage nennt keinen Bautyp; `uncertain` –
 * Sicherheit zum Bautyp unter `TYPE_CONFIDENCE_MIN`: kein Vorschlag, nichts vorausgewählt, Hinweis samt dem, was sonst
 * erkannt wurde; `suggestion` – Bautyp und Parameter, dazu die Zeile „Vorschlag: …“ mit allem, was nicht gebaut wird.
 */
export type DescribeOutcome =
  | { readonly kind: 'none'; readonly text: string }
  | { readonly kind: 'uncertain'; readonly text: string; readonly confidence: number }
  | { readonly kind: 'suggestion'; readonly suggestion: WizardSuggestion; readonly text: string };

export function describeOutcome(
  it: Interpretation, types: BuildingTypeCatalog, themeIds: readonly string[], currentTheme: string, current: ShellStyle, labels: SuggestionLabels = {},
): DescribeOutcome {
  const sug = suggestionFor(it.request, types, themeIds, currentTheme, current, labels);
  if (sug === undefined) return { kind: 'none', text: 'Kein Bautyp erkannt – bitte unten wählen oder genauer beschreiben (z. B. „Taverne“, „Wachturm“)' };
  const sure = typeConfidence(it);
  if (sure !== undefined && sure < TYPE_CONFIDENCE_MIN) {
    const seen = [...sug.applied.slice(1), ...sug.ignored];
    return {
      kind: 'uncertain', confidence: sure,
      text: `${UNCERTAIN_TYPE_TEXT} (unten) oder beschreibe genauer, z. B. „Taverne“, „Wachturm“.${seen.length > 0 ? ` Erkannt: ${seen.join(' · ')}` : ''}`,
    };
  }
  const ignored = sug.ignored.length > 0 ? ` · nicht übernommen: ${sug.ignored.join(', ')}` : '';
  return { kind: 'suggestion', suggestion: sug, text: `Vorschlag: ${sug.applied.join(' · ')}${ignored}` };
}

// ---------------------------------------------------------------------------------------------- F-JEV-iterativ

/** Zeitlimit für „Planen & verbessern“: mehrere Modellrunden und je Runde eine Generierung (Burg bis ~30 s). */
export const DESIGN_TIMEOUT_MS = 120_000;

/** Eine Runde der Schleife, wie `design_iterate` sie protokolliert. */
export interface DesignRoundView {
  readonly n: number;
  readonly phase: 'plan' | 'critic' | 'pick';
  readonly source: 'model' | 'local';
  readonly changes: readonly string[];
  readonly score?: number;
  readonly ms?: number;
  readonly cost?: number;
  readonly error?: string;
}

/** Ergebnis von „Planen & verbessern“: Vorschlag (Hauptgebäude) für den Assistenten und der Verlauf der Runden. */
export interface DesignOutcome {
  readonly interpretation: Interpretation;
  readonly rounds: readonly DesignRoundView[];
  readonly score: number;
  /** Nebenteile und weitere Nutzungen, die der Assistent nicht einstellt (sie entstehen im Export der Engine). */
  readonly extras: readonly string[];
}

/**
 * „Planen & verbessern“ (F-JEV-iterativ): `POST /v1/execute { op: 'design_iterate' }` – der Server plant mit JEV in
 * Runden (Zerlegung, Kritik, Änderung). Übernommen wird wie bei der Beschreibung das Hauptgebäude
 * (`request` = building_generate); Nebenteile nennt `extras`. Wirft bei Netz- oder Serverfehler (kein lokaler Rückfall:
 * die Schaltfläche gibt es nur, wenn der Server den Schalter meldet).
 */
export async function designIterative(prompt: string, deps: DescribeDeps): Promise<DesignOutcome> {
  const text = prompt.trim();
  if (text === '') throw new Error('Bitte beschreiben, was gebaut werden soll');
  const doFetch = deps.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  if (doFetch === undefined) throw new Error(SOURCE_NOTES.unreachable);
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? DESIGN_TIMEOUT_MS);
  try {
    const res = await doFetch(`${deps.baseUrl}/v1/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'design_iterate', input: { prompt: text } }), signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => undefined)) as unknown;
    const data = isObject(body) && body['ok'] === true && isObject(body['data']) ? body['data'] : undefined;
    if (!res.ok || data === undefined || !isObject(data['request'])) {
      const why = isObject(body) && Array.isArray(body['errors']) && body['errors'].length > 0 ? `: ${String(body['errors'][0])}` : '';
      throw new Error(`${res.ok ? SOURCE_NOTES.rejected : rejectionNote(res.status)} (HTTP ${res.status}${why})`);
    }
    const model = typeof data['model'] === 'string' ? data['model'] : undefined;
    const fallback = typeof data['fallback'] === 'string' ? data['fallback'] : undefined;
    const rounds = (Array.isArray(data['rounds']) ? data['rounds'] : []).filter(isObject) as unknown as DesignRoundView[];
    const plan = isObject(data['plan']) ? data['plan'] : {};
    return {
      interpretation: withLocalConfidence({
        source: 'server', request: data['request'] as unknown as EngineRequest,
        ...(model !== undefined ? { model } : {}),
        ...(fallback !== undefined ? { note: SOURCE_NOTES.modelFailed, reason: fallback } : model === 'local' ? { note: SOURCE_NOTES.serverLocal } : {}),
        ms: Math.round(now() - t0),
      }, text, deps.vocabulary),
      rounds,
      score: typeof data['score'] === 'number' ? data['score'] : 0,
      extras: designExtras(plan, deps.vocabulary),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Nebenteile und weitere Nutzungen eines Plans in Worten („Wehrmauer“, „1 Turm“, „Schmiede“). */
export function designExtras(plan: Readonly<Record<string, unknown>>, vocabulary: Vocabulary): string[] {
  const parts = isObject(plan['parts']) ? plan['parts'] : {};
  const out: string[] = [];
  if (parts['wall'] === 'fortress') out.push('Wehrmauer');
  if (parts['wall'] === 'garden') out.push('Gartenmauer');
  const towers = typeof parts['towers'] === 'number' ? parts['towers'] : 0;
  if (towers > 0) out.push(towers === 1 ? '1 Turm' : `${towers} Türme`);
  if (parts['windmill'] === true) out.push('Windmühle');
  if (parts['silo'] === true) out.push('Silo');
  if (parts['bridge'] === true) out.push('Brücke');
  for (const r of Array.isArray(plan['rooms']) ? plan['rooms'] : []) {
    if (typeof r === 'string') out.push(vocabulary.roomTypes.find((x) => x.id === r)?.name ?? r);
  }
  return out;
}

const PHASE_LABEL: Readonly<Record<DesignRoundView['phase'], string>> = { plan: 'Planen', critic: 'Prüfen', pick: 'Wählen' };

/** Verlauf in Zeilen: „Runde 3 · Prüfen (JEV) · Punktzahl 0,81 · Größe M → L (zu klein)“. */
export function designHistory(rounds: readonly DesignRoundView[]): string[] {
  return rounds.map((r) => {
    const who = r.source === 'model' ? 'JEV' : 'lokal';
    const score = typeof r.score === 'number' ? ` · Punktzahl ${r.score.toFixed(2).replace('.', ',')}` : '';
    const changes = r.changes.length > 0 ? ` · ${r.changes.join('; ')}` : '';
    return `Runde ${r.n} · ${PHASE_LABEL[r.phase] ?? r.phase} (${who})${score}${changes}`;
  });
}
