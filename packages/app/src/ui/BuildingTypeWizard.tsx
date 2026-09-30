import { TARGET_VERSIONS } from '@mcda/blueprint';
import type { BuildingTypeCatalog, BuildingTypeDef } from '@mcda/catalog';
import { undergroundDefault } from '@mcda/archetype';
import {
  PARETO_POOL, PARETO_RESERVE, PROPOSAL_LABEL_TEXT, needsReserve, noPlayableNotice, paletteEditorView, pickProposals, planLayoutKey, playablePicks, rollPaletteOverrides,
  withBlockPreset, type PlayabilityFinding, type ProposalCandidate, type ProposalLabel,
} from '@mcda/pipeline';
import type { PaletteOverrides } from '@mcda/core';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  FRONT_OPTIONS, FUNCTION_LEVEL_OPTIONS, PARETO_DEFAULT, SIZE_LABELS, defaultParams, floorChoices, galleryTabs, hasFunctionRooms, inheritedStyle, isDraft, isFixed, paretoCandidate, paretoSeeds, planFacts,
  playabilityNotice, playableCount, proposal,
  proposalCandidates, proposalCount, proposalPlayability, sizesOf, typeLabel, typeSummary, withSize, type FamilyTabId, type Proposal, type TypeContext, type TypeParams,
} from '../buildingTypes.js';
import { LANDFORM_OPTIONS } from '../surroundings.js';
import type { LazyPipelineContext } from '../adapters/browserContext.js';
import { sharedPlayabilityClient, type PlayabilityClient } from '../adapters/playabilityClient.js';
import { sharedBlocksClient, type BlocksClient } from '../adapters/blocksClient.js';
import { unpackVoxels } from '../adapters/blocksJob.js';
import { serializeProject } from '../projectFile.js';
import type { PreviewVoxel } from '../viewer/voxels.js';
import { MAX_PROMPT_LENGTH } from '../embed.js';
import { worldOf } from '../exporting.js';
import { plural } from './plural.js';
import { confidenceText, describeOutcome, designHistory, sourceText, typeConfidence, type DesignOutcome, type Interpretation } from '../nlPrompt.js';
import { errorMessage, sessionFromProject, type ShellStyle } from '../usecases.js';
import { renderThumbnail } from '../viewer/thumbnail.js';
import { afterPaint } from './afterPaint.js';
import { translateHints } from './hintText.js';
import { PaletteEditor } from './PaletteEditor.js';
import { PlanSketch } from './PlanSketch.js';
import { proposalFootLabel, proposalGroups, proposalSummary } from './proposalGroups.js';

/**
 * Beschreibung von außen (Website `nookwright:describe`, Deep-Link `?describe=`): Feld füllen und erkennen – oder die
 * fertige Erkennung übernehmen (kein zweiter Modellaufruf). `id` unterscheidet aufeinanderfolgende Anfragen.
 */
export interface DescribeRequest {
  readonly id: number;
  readonly prompt: string;
  readonly interpretation?: Interpretation | undefined;
}

/** Ein Vorschlag in Arbeit: erst der Seed, dann Plan + Bild (oder Fehler). */
interface Slot {
  readonly seed: number;
  readonly proposal?: Proposal;
  /** Grundriss-Schlüssel (`planLayoutKey`) des Plans; fehlt bei Fehlern und noch offenen Vorschlägen. */
  readonly layout?: string;
  readonly image?: string;
  readonly error?: string;
  /** W8-E: Befunde der Spielbarkeit (leer = spielbar); fehlt bei Fehlern und noch offenen Vorschlägen. */
  readonly issues?: readonly PlayabilityFinding[];
  /** W8-E: gezeigt, obwohl nicht spielbar (Reserve erschöpft) – Hinweis auf der Karte, z. B. „Pflichtobjekt fehlt: …“. */
  readonly notice?: string;
  /** feat/pareto-proposals: Beschriftung und Begründung des bewerteten Vorschlags. */
  readonly label?: ProposalLabel;
  readonly reason?: string;
  /** Platzhaltertext während der Bewertung. */
  readonly status?: string;
}

/**
 * Karte eines Vorschlags: Plan (Probe-Projekt) und Vorschaubild. W8-D: Bild in den echten Blöcken (Theme, Palette,
 * Außen-Deko) – wie das übernommene Haus, nicht in Rollenfarben. Gemeinsam für den bisherigen und den bewerteten Ablauf.
 */
function slotOf(def: BuildingTypeDef, params: TypeParams, seed: number, ctx: TypeContext, style: ShellStyle, pipeline?: LazyPipelineContext): Slot {
  try {
    const p = proposal(def, params, seed, ctx, style);
    const layout = planLayoutKey(p.plan);
    let image: string | undefined;
    try {
      const pctx = pipeline?.loaded(p.project.state.targetVersion.name);
      image = renderThumbnail(p.shell, 360, 220, params.front, pctx === undefined ? undefined : worldOf(p.project, pctx, p.style));
    } catch {
      image = undefined; // ohne WebGL bleibt die Draufsicht
    }
    return { seed, proposal: p, layout, ...(image !== undefined ? { image } : {}) };
  } catch (e) {
    return { seed, error: errorMessage(e) };
  }
}

/** Plattform-Daten erst laden (einmal je Version), damit schon das erste Bild die Blockfarben zeigt; dann `start`. */
function whenReady(pipeline: LazyPipelineContext | undefined, start: () => void): void {
  if (pipeline === undefined) start();
  else void pipeline.ready(TARGET_VERSIONS['1.21.11'].name).then(start, start);
}

/** Fester Speicherzeitpunkt der Projektdatei für den Worker (Inhalt zählt, nicht die Uhr). */
const FIXED_TIME = new Date(0);

/**
 * Vorschläge schrittweise berechnen: je Kandidat eine eigene Aufgabe (setTimeout), damit die UI zwischen den Plänen
 * (je ≤ ~250 ms) zeichnet und Eingaben annimmt. Neue Parameter brechen die laufende Runde ab. W1-G (M2): Kandidaten
 * mit schon gezeigtem Grundriss werden übersprungen, bis `count` verschiedene da sind oder die Reserve
 * (`proposalCandidates`) erschöpft ist – dann füllen die Doppel auf und werden wie bisher zusammengefasst (A8).
 * W8-E: ebenso unspielbare Kandidaten (Pflichtobjekt fehlt …, `proposalPlayability`, Regel `playablePicks` wie
 * `building_propose`); reicht die Reserve nicht, zeigt die Karte den Grund („Pflichtobjekt fehlt: …“), nie still.
 */
function useProposals(
  def: BuildingTypeDef | undefined, params: TypeParams | undefined, candidates: readonly number[], count: number, ctx: TypeContext, style: ShellStyle,
  pipeline?: LazyPipelineContext, playability?: PlayabilityClient, thumbs?: BlocksClient,
): { readonly slots: readonly Slot[]; readonly done: boolean } {
  const [computed, setComputed] = useState<readonly Slot[]>([]);
  const [finished, setFinished] = useState(false);
  const key = def === undefined || params === undefined ? '' : `${def.id}|${JSON.stringify(params)}|${candidates.join(',')}|${count}`;
  useEffect(() => {
    if (def === undefined || params === undefined) return;
    setComputed([]);
    setFinished(false);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done: Slot[] = [];
    // W14: Spielbarkeit im Worker (parallel zu Plan und Bild hier); der nächste Kandidat wird schon angefragt
    const asked = new Map<number, Promise<readonly PlayabilityFinding[]>>();
    const ask = (i: number): Promise<readonly PlayabilityFinding[]> | undefined => {
      if (playability === undefined || i >= candidates.length) return undefined;
      let q = asked.get(i);
      if (q === undefined) {
        q = playability.issues(def.id, params, candidates[i]!);
        q.catch(() => undefined); // abgelehnt → Rechnung im Haupt-Thread (unten)
        asked.set(i, q);
      }
      return q;
    };
    const push = (slot: Slot, i: number): void => {
      done.push(slot);
      setComputed((prev) => [...prev, slot]);
      step(i + 1);
    };
    const step = (i: number): void => {
      if (cancelled) return;
      if (i >= candidates.length || playableCount(done) >= count) {
        setFinished(true);
        return;
      }
      const pending = ask(i);
      ask(i + 1);
      timer = setTimeout(() => {
        if (cancelled) return;
        const seed = candidates[i]!;
        let p: Proposal, layout: string;
        try {
          p = proposal(def, params, seed, ctx, style);
          layout = planLayoutKey(p.plan);
        } catch (e) {
          push({ seed, error: errorMessage(e) }, i);
          return;
        }
        // W8-D: Bild in den echten Blöcken (Theme, Palette, Außen-Deko) – wie das übernommene Haus, nicht in Rollenfarben.
        // W14: die Blöcke rechnet der Blöcke-Worker (gleiche Quader), gezeichnet wird hier; ohne Worker wie bisher.
        const pctx = pipeline?.loaded(p.project.state.targetVersion.name);
        const draw = (blocks?: readonly PreviewVoxel[]): string | undefined => {
          try {
            return renderThumbnail(p.shell, 360, 220, params.front, blocks === undefined && pctx !== undefined ? worldOf(p.project, pctx, p.style) : undefined, blocks);
          } catch {
            return undefined; // ohne WebGL bleibt die Draufsicht
          }
        };
        const image: Promise<string | undefined> = pctx === undefined || thumbs === undefined
          ? Promise.resolve(draw())
          : thumbs.thumbnail(serializeProject(sessionFromProject(p.project, p.style), { savedAt: FIXED_TIME })).then((r) => draw(unpackVoxels(r.voxels)), () => draw());
        // W8-E: spielbar? (Einrichtung wie beim Übernehmen, ohne Umgebung) – ohne Worker bzw. bei dessen Fehler hier
        const issues = (pending ?? Promise.reject(new Error('ohne Worker'))).catch(() => proposalPlayability(def, params, seed, ctx));
        Promise.all([image, issues]).then(
          ([img, found]) => !cancelled && push({ seed, proposal: p, layout, issues: found, ...(img !== undefined ? { image: img } : {}) }, i),
          (e: unknown) => !cancelled && push({ seed, error: errorMessage(e) }, i),
        );
      }, i === 0 ? 30 : 0);
    };
    whenReady(pipeline, () => step(0));
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      playability?.cancelPending();
      thumbs?.cancelThumbnails();
    };
    // style/ctx: pro Öffnen des Assistenten fest
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Gezeigt: verschiedene spielbare Grundrisse in Kandidaten-Reihenfolge (W8-E); solange gerechnet wird, Platzhalter für
  // den Rest. Reicht die Reserve nicht, kommen unspielbare Kandidaten mit Hinweis dazu (nie still).
  const picked = playablePicks(computed.map((s) => s.layout), count, (i) => computed[i]!.issues?.length === 0, finished);
  const shown = picked.picks.map((i): Slot => {
    const s = computed[i]!;
    return picked.unplayable.includes(i) && s.issues !== undefined ? { ...s, notice: playabilityNotice(s.issues, ctx) } : s;
  });
  const pending = finished ? [] : candidates.slice(computed.length, computed.length + Math.max(0, count - shown.length)).map((seed): Slot => ({ seed }));
  // Kein Bautyp gewählt (z. B. nach „Kein Bautyp sicher erkannt“): nichts zeigen, nichts übernehmen
  if (key === '') return { slots: [], done: false };
  return { slots: [...shown, ...pending], done: finished };
}

/** Platzhalter eines nicht baubaren Kandidaten: zählt als unspielbar und wird nie gewählt. */
const failedCandidate = (seed: number, i: number): ProposalCandidate => ({
  seed, layout: `\u0000${i}`, issues: ['unreachable'], findings: [{ issue: 'unreachable' }],
  plan: undefined as never, project: undefined as never, scores: undefined as never, raw: undefined as never,
});

/**
 * feat/pareto-proposals: bewertete Runde. Jeder Kandidat des Pools (`PARETO_POOL`) wird in einer eigenen Aufgabe
 * eingerichtet und bewertet (`paretoCandidate`, dieselbe Regel wie `building_propose` mit `pareto`, Spielbarkeit wie W8-E);
 * die Reserve dahinter nur, wenn einige, aber zu wenige spielbar sind (`needsReserve`). Danach wählt `pickProposals` drei
 * beschriftete Vorschläge; erst dann entstehen Karten und Vorschaubilder (W8-D). Ohne spielbaren Kandidaten die ersten
 * drei mit ihrem Befund („Pflichtobjekt fehlt: …“, W8-E) und ein Hinweis über den Karten (`notice`, Review A3) – nie still.
 */
function useParetoProposals(
  def: BuildingTypeDef | undefined, params: TypeParams | undefined, candidates: readonly number[], ctx: TypeContext, style: ShellStyle,
  pipeline?: LazyPipelineContext,
): { readonly slots: readonly Slot[]; readonly done: boolean; readonly notice?: string } {
  const [evaluated, setEvaluated] = useState(0);
  const [cards, setCards] = useState<{ readonly slots: readonly Slot[]; readonly notice?: string } | undefined>(undefined);
  const key = def === undefined || params === undefined ? '' : `${def.id}|${JSON.stringify(params)}|${candidates.join(',')}`;
  useEffect(() => {
    if (def === undefined || params === undefined) return;
    setEvaluated(0);
    setCards(undefined);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pool: ProposalCandidate[] = [];
    const later = (f: () => void, ms = 0): void => {
      timer = setTimeout(() => {
        if (!cancelled) f();
      }, ms);
    };
    type Pick = { readonly seed: number; readonly label?: ProposalLabel; readonly reason?: string; readonly findings?: readonly PlayabilityFinding[] };
    const build = (picks: readonly Pick[], done: readonly Slot[], notice?: string): void => {
      if (done.length >= picks.length) {
        setCards({ slots: done, ...(notice !== undefined ? { notice } : {}) });
        return;
      }
      later(() => {
        const pk = picks[done.length]!;
        const slot = slotOf(def, params, pk.seed, ctx, style, pipeline);
        build(picks, [...done, {
          ...slot,
          ...(pk.label !== undefined ? { label: pk.label } : {}),
          ...(pk.reason !== undefined ? { reason: pk.reason } : {}),
          ...(pk.findings !== undefined && pk.findings.length > 0 ? { issues: pk.findings, notice: playabilityNotice(pk.findings, ctx) } : {}),
        }], notice);
      });
    };
    const step = (i: number): void => {
      if (i >= candidates.length || (i >= PARETO_POOL && !needsReserve(pool, 3))) {
        const { picks } = pickProposals(pool);
        if (picks.length > 0) build(picks.map((pk) => ({ seed: pool[pk.index]!.seed, label: pk.label, reason: pk.reason })), []);
        else build(pool.slice(0, 3).map((c) => ({ seed: c.seed, findings: c.findings })), [], noPlayableNotice(pool));
        return;
      }
      later(() => {
        const seed = candidates[i]!;
        try {
          pool.push(paretoCandidate(def, params, seed, ctx));
        } catch {
          pool.push(failedCandidate(seed, i));
        }
        setEvaluated(i + 1);
        step(i + 1);
      }, i === 0 ? 30 : 0);
    };
    whenReady(pipeline, () => step(0));
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // style/ctx/pipeline: pro Öffnen des Assistenten fest
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === '') return { slots: [], done: false };
  if (cards !== undefined) return { slots: cards.slots, done: true, ...(cards.notice !== undefined ? { notice: cards.notice } : {}) };
  // Nenner fest (Review A6): der Pool; Reserve-Kandidaten werden eigens benannt
  const status = evaluated < PARETO_POOL
    ? `bewerte Kandidat ${evaluated + 1} von ${PARETO_POOL} …`
    : `bewerte Reserve-Kandidat ${evaluated - PARETO_POOL + 1} …`;
  return { slots: candidates.slice(0, 3).map((seed): Slot => ({ seed, status })), done: false };
}

export interface WizardProps {
  readonly types: BuildingTypeCatalog;
  readonly ctx: TypeContext;
  readonly themes: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** Farbpaletten (Q4, research/54): unabhängig vom Theme; leer/fehlend = kein Auswahlfeld. */
  readonly palettes?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly mood: string; readonly styles: readonly string[] }>;
  /** Theme und Stil des bisherigen Projekts (Startwert; feste Grundrisse erben den Stil). */
  readonly currentTheme: string;
  /** Palette des bisherigen Projekts (Startwert). */
  readonly currentPalette?: string | undefined;
  /** W13-G: Blockpalette des bisherigen Projekts (Startwert wie die Farbwelt); fehlt = Farben des Stils. */
  readonly currentPaletteOverrides?: PaletteOverrides | undefined;
  readonly currentStyle: ShellStyle;
  /** Zufalls-Seed für eine neue Runde (Browser-Adapter). */
  readonly randomSeed: () => number;
  readonly roomTypeName: (id: string) => string;
  readonly onAccept: (def: BuildingTypeDef, params: TypeParams, seed: number) => void;
  /** „Beschreibe dein Gebäude“: Freitext → Engine-Anfrage (Server, sonst lokal); fehlt = Feld ausgeblendet. */
  readonly describe?: ((prompt: string) => Promise<Interpretation>) | undefined;
  /**
   * F-JEV-iterativ: „Planen & verbessern“ (Server-Operation design_iterate mit JEV als Planer und Kritiker). Die
   * Schaltfläche erscheint nur, wenn die letzte Erkennung vom Server mit eingeschaltetem Schalter kam (`iterate`).
   */
  readonly designIterative?: ((prompt: string) => Promise<DesignOutcome>) | undefined;
  /** Beschreibung von außen (Website, Deep-Link); jede neue `id` wird einmal ausgeführt. */
  readonly request?: DescribeRequest | undefined;
  /** Beim Öffnen das Beschreibungsfeld fokussieren (Leerzustand „Bautyp wählen oder beschreiben“). */
  readonly focusDescribe?: boolean | undefined;
  readonly onEmpty: () => void;
  readonly onClose: () => void;
  /** W8-D: Pipeline für Vorschaubilder in echten Blöcken; fehlt = Rollenfarben. */
  readonly pipeline?: LazyPipelineContext | undefined;
}

/** Zustand der Zeile „Beschreibe dein Gebäude“. */
interface NlState {
  readonly busy: boolean;
  /** Ergebnis: übernommene Angaben bzw. „kein Bautyp erkannt“. */
  readonly text?: string;
  readonly error?: boolean;
  /** Quelle in Nutzersprache („Erkannt mit JEV (…)“, „KI-Server nicht erreichbar – im Browser erkannt“). */
  readonly source?: string;
  /** Tooltip: Konfidenz je Feld und technischer Grund eines Rückfalls. */
  readonly detail?: string;
  /** F-JEV-iterativ: Server bietet „Planen & verbessern“ an (Schalter an). */
  readonly iterate?: boolean;
  /** F-JEV-iterativ: Verlauf der Runden (Zeilen) und Nebenteile, die nur im Export der Engine entstehen. */
  readonly history?: readonly string[];
  readonly extras?: readonly string[];
}

/**
 * Assistent „Neues Projekt aus Bautyp“ (research/19 §7.7): ① Galerie nach Familie, ② Parameter, ③ drei Vorschläge
 * nebeneinander (je Seed; „↻ 3 neue“), ④ Übernehmen → normaler Editor (ein Undo-Schritt zurück).
 */
export function BuildingTypeWizard(p: WizardProps) {
  const { onClose } = p;
  const tabs = useMemo(() => galleryTabs(p.types), [p.types]);
  const [tab, setTab] = useState<FamilyTabId>(tabs[0]?.id ?? 'house');
  const [typeId, setTypeId] = useState<string | undefined>(() => tabs[0]?.types.find((d) => !isDraft(d) && !isFixed(d))?.id ?? tabs[0]?.types[0]?.id);
  const def = typeId === undefined ? undefined : p.types.get(typeId);
  const themeIds = useMemo(() => p.themes.map((t) => t.id), [p.themes]);
  // W8-F: Auswahlfelder mit eigener <label for>, nicht umschließend – sonst gehören alle Optionstexte zum Label
  // („Palette … (Themefarben)“ fand sich unter „Theme“, zwei Treffer für ein Feld).
  const fieldId = useId();
  const [params, setParams] = useState<TypeParams | undefined>(() => (def === undefined ? undefined : {
    ...defaultParams(def, themeIds, p.currentTheme, { ...p.currentStyle, ...(p.currentPalette !== undefined ? { paletteId: p.currentPalette } : {}) }),
    ...(p.currentPaletteOverrides !== undefined ? { paletteOverrides: p.currentPaletteOverrides } : {}),
  }));
  // W13-G: Blockpalette vor dem Generieren – Ansicht aus @mcda/pipeline (gleiche Regel wie palette_suggest). Die Familien
  // der Zielversion kennt der Assistent, sobald die Plattform geladen ist; vorher gilt die Formtabelle.
  const paletteFamilies = p.pipeline?.loaded('1.21.11')?.platform('1.21.11').families;
  const paletteCtx = useMemo(() => ({ themes: p.ctx.themes, ...(p.ctx.palettes !== undefined ? { palettes: p.ctx.palettes } : {}) }), [p.ctx.themes, p.ctx.palettes]);
  const paletteView = useMemo(
    () => (params === undefined ? undefined : paletteEditorView(paletteCtx, params.themeId, params.paletteId, params.paletteOverrides, paletteFamilies)),
    [paletteCtx, params?.themeId, params?.paletteId, params?.paletteOverrides, paletteFamilies],
  );
  const [base, setBase] = useState(() => p.randomSeed());
  // M2: Kandidaten samt Reserve (die ersten wie bisher `proposalSeeds(base)`), gezeigt werden die ersten verschiedenen
  const candidates = useMemo(() => (def === undefined ? [] : proposalCandidates(def, base)), [base, def]);
  const count = def === undefined ? 0 : proposalCount(def);
  // W14: Spielbarkeit im Web Worker (ohne Worker, z. B. in Tests, wie bisher im Haupt-Thread)
  const playability = useMemo(() => sharedPlayabilityClient(), []);
  const thumbs = useMemo(() => sharedBlocksClient(), []);
  // feat/pareto-proposals: „Vorschläge bewerten“ (nur bei drei Vorschlägen; feste Vorlagen haben einen)
  const [rated, setRated] = useState(PARETO_DEFAULT);
  const pareto = rated && count === 3;
  const pool = useMemo(() => (pareto ? paretoSeeds(base, PARETO_POOL + PARETO_RESERVE) : []), [base, pareto]);
  const plain = useProposals(pareto ? undefined : def, params, candidates, count, p.ctx, p.currentStyle, p.pipeline, playability, thumbs);
  const scored = useParetoProposals(pareto ? def : undefined, params, pool, p.ctx, p.currentStyle, p.pipeline);
  const { slots, done: roundDone } = pareto ? scored : plain;
  const paretoNotice = pareto ? scored.notice : undefined;
  const [chosen, setChosen] = useState(0);
  const selected = slots[chosen];
  // Gleiche Grundrisse als eine Karte (A8); Beschriftung erst, wenn die Runde fertig ist
  // Bewertete Vorschläge bleiben einzeln (gleicher Grundriss hat dort eine andere Einrichtung und Beschriftung)
  const groups = useMemo(() => (pareto ? slots.map((s, index) => ({ index, seeds: [s.seed] })) : proposalGroups(slots)), [slots, pareto]);
  const done = roundDone && slots.length > 0 && slots.every((s) => s.proposal !== undefined || s.error !== undefined);
  const summary = proposalSummary(def !== undefined && isFixed(def), groups, slots.length, done);
  const themeName = (id: string): string => p.themes.find((t) => t.id === id)?.name ?? id;
  // L4: was eine feste Vorlage vom bisherigen Projekt erbt (Dach, Theme …), sichtbar statt überraschend
  const inherited = def === undefined || params === undefined ? [] : inheritedStyle(def, params, p.currentStyle, p.currentTheme, themeName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choose = (d: BuildingTypeDef) => {
    setTypeId(d.id);
    setParams(defaultParams(d, themeIds, p.currentTheme, p.currentStyle));
    setChosen(0);
  };
  const patch = (x: Partial<TypeParams>) => {
    setParams((q) => (q === undefined ? q : { ...q, ...x }));
    setChosen(0);
  };
  const [prompt, setPrompt] = useState('');
  const [nl, setNl] = useState<NlState>({ busy: false });
  const describe = p.describe;
  /** Laufende Erkennung: nur das Ergebnis der jüngsten Anfrage zählt (Website kann nachschicken). */
  const runRef = useRef(0);
  const promptRef = useRef<HTMLInputElement>(null);

  /**
   * Erkennung übernehmen – derselbe Weg für eigene Erkennung (`describe`) und für die fertige Erkennung der Website
   * (`nookwright:describe` mit `interpretation`): `suggestionFor` → Bautyp, Parameter, Seed → Vorschläge.
   */
  const applyInterpretation = (it: Interpretation, fromWebsite: boolean) => {
    const out = describeOutcome(it, p.types, themeIds, p.currentTheme, p.currentStyle, { themeName });
    // W8-D: Laufzeit nur im Tooltip (schwankt je Lauf; die sichtbare UI bleibt deterministisch)
    const source = `${fromWebsite ? 'Vom KI-Architekten übernommen · ' : ''}${sourceText(it)}`;
    const conf = confidenceText(it.confidence);
    const sure = typeConfidence(it);
    const detail = [
      conf !== '' ? `Konfidenz je Feld: ${conf}` : undefined,
      it.confidence?.['buildingTypeId'] === undefined && sure !== undefined ? `Sicherheit Bautyp (lokal): ${sure.toFixed(2).replace('.', ',')}` : undefined,
      it.reason !== undefined ? `Technisch: ${it.reason}` : undefined,
      it.ms !== undefined ? `Dauer: ${it.ms} ms` : undefined,
    ].filter((x) => x !== undefined).join('\n');
    const extra = { ...(detail !== '' ? { detail } : {}), ...(it.iterate === true ? { iterate: true } : {}) };
    if (out.kind === 'none') {
      setNl({ busy: false, text: out.text, error: true, source, ...extra });
      return;
    }
    // S2/R1-02: kein Bautyp sicher erkannt → nichts vortäuschen (kein stilles Beispielhaus) und nichts vorauswählen
    if (out.kind === 'uncertain') {
      setTypeId(undefined);
      setParams(undefined);
      setChosen(0);
      setNl({ busy: false, error: true, text: out.text, source, ...extra });
      return;
    }
    const sug = out.suggestion;
    const t = tabs.find((x) => x.types.some((d) => d.id === sug.def.id));
    if (t !== undefined) setTab(t.id);
    setTypeId(sug.def.id);
    setParams(sug.params);
    if (sug.seed !== undefined) setBase(sug.seed);
    setChosen(0);
    setNl({ busy: false, text: out.text, source, ...extra });
  };
  const runDescribe = (text: string) => {
    if (describe === undefined) return;
    const run = ++runRef.current;
    setNl({ busy: true });
    describe(text).then(
      (it) => {
        if (run === runRef.current) applyInterpretation(it, false);
      },
      (err: unknown) => {
        if (run === runRef.current) setNl({ busy: false, text: errorMessage(err), error: true });
      },
    );
  };
  const designIterative = p.designIterative;
  /** F-JEV-iterativ: Planen & verbessern – Vorschlag wie bei der Beschreibung, dazu Verlauf und Nebenteile. */
  const runDesign = () => {
    if (designIterative === undefined || nl.busy || prompt.trim() === '') return;
    const run = ++runRef.current;
    setNl({ busy: true, iterate: true });
    designIterative(prompt).then(
      (out) => {
        if (run !== runRef.current) return;
        applyInterpretation({ ...out.interpretation, iterate: true }, false);
        setNl((s) => ({ ...s, history: designHistory(out.rounds), extras: out.extras }));
      },
      (err: unknown) => {
        if (run === runRef.current) setNl({ busy: false, iterate: true, text: errorMessage(err), error: true });
      },
    );
  };
  const onDescribe = (e: FormEvent) => {
    e.preventDefault();
    if (describe === undefined || nl.busy) return;
    runDescribe(prompt);
  };

  // Beschreibung von außen: jede Anfrage genau einmal (StrictMode ruft Effekte doppelt auf)
  const handledRef = useRef<number | undefined>(undefined);
  const request = p.request;
  useEffect(() => {
    if (request === undefined || handledRef.current === request.id) return;
    handledRef.current = request.id;
    setPrompt(request.prompt);
    if (request.interpretation !== undefined) {
      runRef.current++; // eine noch laufende eigene Erkennung überschreibt das Ergebnis der Website nicht
      applyInterpretation(request.interpretation, true);
    } else runDescribe(request.prompt);
    // applyInterpretation/runDescribe: je Anfrage mit dem Stand beim Eintreffen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Leerzustand „Bautyp wählen oder beschreiben“: gleich ins Beschreibungsfeld
  useEffect(() => {
    if (p.focusDescribe === true) promptRef.current?.focus();
    // nur beim Öffnen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // W11-B: Übernehmen rechnet synchron (Einrichten aller Räume, auf langsamen Rechnern viele Sekunden, R6: Erdhaus
  // bis 30 s ohne Anzeige). Erst „Wird gebaut …“ zeichnen, dann rechnen; ein zweiter Klick startet nichts doppelt.
  const [accepting, setAccepting] = useState(false);
  const proposalsRef = useRef<HTMLElement>(null);
  const accept = () => {
    if (accepting || def === undefined || params === undefined || selected?.proposal === undefined) return;
    const [d, q, seed] = [def, params, selected.seed];
    setAccepting(true);
    afterPaint(() => {
      try {
        p.onAccept(d, q, seed);
      } finally {
        setAccepting(false);
      }
    });
  };
  const chosenFacts = selected?.proposal === undefined ? undefined : planFacts(selected.proposal.plan);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const sizes = def === undefined ? [] : sizesOf(def);
  const floors = def === undefined || params === undefined ? [] : floorChoices(def, params.size);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal wizard${accepting ? ' is-busy' : ''}`} role="dialog" aria-modal="true" aria-labelledby="wizard-title" aria-busy={accepting}>
        <div className="modal-head">
          <h2 id="wizard-title">Neues Projekt aus Bautyp</h2>
          <div className="row end">
            <button type="button" onClick={p.onEmpty} title="Leeres Projekt: selbst Räume malen (Rückgängig kehrt zurück)">
              Leeres Projekt
            </button>
            <button type="button" className="link" onClick={onClose} aria-label="Schließen">
              ✕
            </button>
          </div>
        </div>

        {describe !== undefined && (
          <section aria-label="Beschreibe dein Gebäude" className="nl-describe">
            <form className="nl-form" onSubmit={onDescribe}>
              <label htmlFor="nl-prompt" className="nl-label">
                Beschreibe dein Gebäude
              </label>
              <input
                id="nl-prompt"
                ref={promptRef}
                type="text"
                value={prompt}
                placeholder="z. B. große mittelalterliche Taverne mit drei Etagen, Eingang nach Osten"
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={MAX_PROMPT_LENGTH}
                autoComplete="off"
                title="Freitext: Bautyp, Größe, Etagen, Stil, Dach, Lage – füllt Bautyp und Parameter unten aus"
              />
              <button type="submit" className="primary" disabled={nl.busy || prompt.trim() === ''}>
                {nl.busy ? 'Erkenne …' : 'Vorschlagen'}
              </button>
            </form>
            {nl.text !== undefined && (
              <p className={`small nl-result${nl.error === true ? ' error' : ''}`} role="status" {...(nl.detail !== undefined ? { title: nl.detail } : {})}>
                {nl.text}
              </p>
            )}
            {nl.source !== undefined && (
              <p className="small muted nl-note" {...(nl.detail !== undefined ? { title: nl.detail } : {})}>
                {nl.source}
              </p>
            )}
            {designIterative !== undefined && nl.iterate === true && (
              <div className="nl-iterate">
                <button type="button" onClick={runDesign} disabled={nl.busy || prompt.trim() === ''} title="JEV zerlegt die Bitte in Teile, prüft die erzeugte Anlage und verbessert sie in mehreren Runden (dauert länger)">
                  {nl.busy ? 'Plane …' : 'Planen & verbessern (mehrere Runden)'}
                </button>
                {nl.extras !== undefined && nl.extras.length > 0 && (
                  <p className="small muted">Nebenteile (nur im Export der Engine, hier wird das Hauptgebäude übernommen): {nl.extras.join(', ')}</p>
                )}
                {nl.history !== undefined && nl.history.length > 0 && (
                  <details className="small nl-history">
                    <summary>Verlauf ({nl.history.length} Runden)</summary>
                    <ol>
                      {nl.history.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            )}
          </section>
        )}

        <section aria-label="Bautyp">
          <h3 className="wizard-step">
            <span>1</span> Bautyp
          </h3>
          <div className="segmented" role="tablist" aria-label="Familie">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={t.id === current?.id} className={t.id === current?.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label} <span className="count">{t.types.length}</span>
              </button>
            ))}
          </div>
          <div className="type-grid">
            {(current?.types ?? []).map((d) => (
              <button key={d.id} type="button" className={`type-card${d.id === typeId ? ' selected' : ''}`} onClick={() => choose(d)} aria-pressed={d.id === typeId}>
                <span className="type-card-head">
                  <strong>{typeLabel(d)}</strong>
                  {isDraft(d) ? (
                    <span className="badge draft" title="Entwurf: Generator oder Regeln noch unvollständig">
                      Vorschau
                    </span>
                  ) : isFixed(d) ? (
                    <span className="badge fixed" title="Fester Grundriss (frühere Vorlage)">
                      Vorlage
                    </span>
                  ) : null}
                </span>
                <span className="type-card-text">{typeSummary(d, p.ctx.catalog)}</span>
              </button>
            ))}
          </div>
        </section>

        {def !== undefined && params !== undefined && (
          <section aria-label="Parameter">
            <h3 className="wizard-step">
              <span>2</span> {typeLabel(def)}: Größe und Lage
            </h3>
            <div className="wizard-params">
              {sizes.length > 0 ? (
                <div className="param">
                  <span>Größe</span>
                  <span className="segmented" role="group" aria-label="Größe">
                    {sizes.map((s) => (
                      <button key={s} type="button" className={s === params.size ? 'active' : ''} onClick={() => setParams(withSize(def, params, s))} title={SIZE_LABELS[s]}>
                        {s}
                      </button>
                    ))}
                  </span>
                </div>
              ) : (
                <span className="param muted small">Fester Grundriss</span>
              )}
              {floors.length > 0 && (
                <div className="param">
                  <label htmlFor={`${fieldId}-floors`}>Etagen</label>
                  <select id={`${fieldId}-floors`} value={params.floors ?? ''} onChange={(e) => patch({ floors: e.target.value === '' ? undefined : Number(e.target.value) })}>
                    <option value="">Zufall</option>
                    {floors.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="param">
                <span>Front</span>
                <span className="segmented" role="group" aria-label="Front">
                  {FRONT_OPTIONS.map((f) => (
                    <button key={f.id} type="button" className={f.id === params.front ? 'active' : ''} onClick={() => patch({ front: f.id })} title={f.hint}>
                      {f.label}
                    </button>
                  ))}
                </span>
              </div>
              {hasFunctionRooms(def) && (
                <div className="param">
                  <span title="Wie viele funktionale Anlagen das Haus bekommt (Lager mit Sortierer, Farmen, Schmelze, Brauerei, Tresor …); die Räume sind über Türen und Treppen erreichbar">Funktionsgrad</span>
                  <span className="segmented" role="group" aria-label="Funktionsgrad">
                    {FUNCTION_LEVEL_OPTIONS.map((o) => (
                      <button key={o.id} type="button" className={o.id === (params.functionLevel ?? 'off') ? 'active' : ''} onClick={() => patch({ functionLevel: o.id })} title={o.hint}>
                        {o.label}
                      </button>
                    ))}
                  </span>
                </div>
              )}
              <div className="param">
                <span title="Landschaft um das Haus: Hang hinter dem Haus mit Stützmauern, Teich, Findlinge, Moos am Sockel und dichtere Bepflanzung. Gilt für den Neubau; danach im Panel Umgebung änderbar">Geländeform</span>
                <span className="segmented" role="group" aria-label="Geländeform">
                  {LANDFORM_OPTIONS.map((o) => (
                    <button key={o.id} type="button" className={o.id === (params.landform ?? 'flat') ? 'active' : ''} onClick={() => patch({ landform: o.id })} title={o.hint}>
                      {o.label}
                    </button>
                  ))}
                </span>
              </div>
              <div className="param">
                <label htmlFor={`${fieldId}-theme`}>Stil</label>
                <select id={`${fieldId}-theme`} value={params.themeId} onChange={(e) => patch({ themeId: e.target.value })}>
                  {p.themes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {def.themes?.includes(t.id) === true ? ' (passt)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {p.palettes !== undefined && p.palettes.length > 0 && (
                <div className="param" title="Farbwelt neben dem Stil: färbt Wände, Dach, Rahmen, Holz, Boden, Akzent, Glas, Licht und Bewuchs um; die Bauweise des Stils bleibt">
                  <label htmlFor={`${fieldId}-palette`}>Farbwelt</label>
                  <select id={`${fieldId}-palette`} value={params.paletteId ?? ''} onChange={(e) => patch({ paletteId: e.target.value === '' ? undefined : e.target.value })}>
                    <option value="">Ohne Farbwelt (Farben des Stils)</option>
                    {p.palettes.map((pal) => (
                      <option key={pal.id} value={pal.id}>
                        {pal.name}
                        {pal.styles.includes(params.themeId) ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <details className="pal-section wizard-palette">
                <summary>
                  Blockpalette anpassen
                  <span className="muted small">{params.paletteOverrides === undefined ? ' – Farben des Stils' : ' – eigene Farben'}</span>
                </summary>
                <PaletteEditor
                  compact
                  view={paletteView}
                  overrides={params.paletteOverrides}
                  families={paletteFamilies}
                  onChange={(next) => patch({ paletteOverrides: next })}
                  onRoll={(locked, seed) =>
                    patch({ paletteOverrides: rollPaletteOverrides(paletteCtx, params.themeId, params.paletteId, params.paletteOverrides, paletteFamilies, seed, locked) })}
                />
              </details>
              <label className="check" title="Außen-Deko: Fensterläden, Blumenkästen, Vortreppe, Laternen, Schornsteine …">
                <input type="checkbox" checked={params.exterior} onChange={(e) => patch({ exterior: e.target.checked })} /> Außenanlagen
              </label>
              <label className="check" title={def.site === undefined ? 'Dieser Bautyp bringt keine Gelände-Vorlage mit' : 'Gelände mit Vorlage und Zonen des Bautyps (Hof, Garten, Platz …)'}>
                <input type="checkbox" checked={params.site} disabled={def.site === undefined} onChange={(e) => patch({ site: e.target.checked })} /> Gelände-Vorlage
              </label>
              <label className="check" title="Schwer farmbare Blöcke (Prismarin, Purpur, Endstein, Erzblöcke, Köpfe …) sperren – der Generator ersetzt sie passend; einzeln anpassbar im Tab „Material“">
                <input
                  type="checkbox"
                  checked={params.blockRules?.preset === 'easy_farm'}
                  onChange={(e) => patch({ blockRules: withBlockPreset(params.blockRules, 'easy_farm', e.target.checked) })}
                /> Nur leicht farmbar
              </label>
              <label className="check" title="Unterbau: Keller- bzw. Dungeon-Ebene unter und um das Haus (Weinkeller, Lager, Kerker, Schatzkammer …) mit Gängen und Rundwegen, dazu Zusatztüren für Rundgänge im Haus">
                <input type="checkbox" checked={params.underground ?? undergroundDefault(def.id)} onChange={(e) => patch({ underground: e.target.checked })} /> Keller &amp; Gewölbe darunter
              </label>
              {count === 3 && (
                <label className="check" title="Mehrere Kandidaten einrichten und bewerten (Einrichtung, Fassade, Tageslicht, Laufwege, kurze Wege, Lager/Arbeit, Kompaktheit), nur spielbare. Zeigt „Am schönsten“, „Am praktischsten“ und „Ausgewogen“ mit Begründung – dauert einige Sekunden">
                  <input type="checkbox" checked={rated} onChange={(e) => (setRated(e.target.checked), setChosen(0))} /> Vorschläge bewerten
                </label>
              )}
            </div>
            {inherited.length > 0 && (
              <p className="small muted wizard-inherit" title="Feste Vorlagen übernehmen Stil-Angaben, die sie nicht selbst festlegen, vom bisherigen Projekt (wie die früheren Vorlagen)">
                Vom bisherigen Projekt übernommen: {inherited.join(' · ')} – nach dem Übernehmen im Editor änderbar.
              </p>
            )}
          </section>
        )}

        {def !== undefined && params !== undefined && (
          <section aria-label="Vorschläge" ref={proposalsRef}>
            <div className="wizard-step-row">
              <h3 className="wizard-step">
                <span>3</span> {summary.heading}
              </h3>
              {summary.note !== undefined && <span className="small muted proposal-note">{summary.note}</span>}
              {paretoNotice !== undefined && <span className="small proposal-note proposal-warning" role="status">{paretoNotice}</span>}
              {summary.reroll !== undefined && (
                <button type="button" onClick={() => (setBase(p.randomSeed()), setChosen(0))} title={summary.reroll.title}>
                  {summary.reroll.label}
                </button>
              )}
            </div>
            <div className={`proposal-grid count-${groups.length}`}>
              {groups.map((g) => {
                const s = slots[g.index]!;
                return (
                  <ProposalCard
                    key={s.seed}
                    slot={s}
                    index={g.index}
                    same={g.seeds}
                    selected={g.index === chosen}
                    onSelect={() => setChosen(g.index)}
                    onAccept={accept}
                    roomTypeName={p.roomTypeName}
                  />
                );
              })}
            </div>
          </section>
        )}

        <div className="row end wizard-foot">
          {chosenFacts !== undefined && (
            // W11-B: bei 1280 × 720 liegen die Vorschläge unter dem Falz – der Fuß sagt, welcher übernommen wird
            <button type="button" className="link wizard-chosen" onClick={() => proposalsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })} title="Zu den Vorschlägen scrollen">
              {proposalFootLabel(groups.findIndex((g) => g.index === chosen), chosenFacts)}
            </button>
          )}
          {selected?.proposal !== undefined && selected.proposal.plan.hints.length > 0 && (
            <span className="muted small wizard-hints" title={translateHints(selected.proposal.plan.hints, p.roomTypeName).join('\n')}>
              {selected.proposal.plan.hints.length} {selected.proposal.plan.hints.length === 1 ? 'Hinweis' : 'Hinweise'}: {translateHints(selected.proposal.plan.hints, p.roomTypeName)[0]}
            </span>
          )}
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="primary" disabled={selected?.proposal === undefined || accepting} aria-busy={accepting} onClick={accept} title="Vorschlag übernehmen: Räume werden eingerichtet; Rückgängig kehrt zum bisherigen Projekt zurück">
            {accepting ? 'Wird gebaut …' : 'Übernehmen'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProposalCard(props: {
  slot: Slot;
  index: number;
  /** Seeds mit genau diesem Grundriss (zusammengefasst, A8); eins = keine Doppel. */
  same: readonly number[];
  selected: boolean;
  onSelect: () => void;
  onAccept: () => void;
  roomTypeName: (id: string) => string;
}) {
  const { slot } = props;
  const pr = slot.proposal;
  const facts = pr === undefined ? undefined : planFacts(pr.plan);
  const floors = pr === undefined ? [] : [...pr.plan.floors].map((f) => f.index).sort((a, b) => a - b);
  return (
    <div
      role="button"
      tabIndex={pr === undefined ? -1 : 0}
      className={`proposal${props.selected ? ' selected' : ''}${pr === undefined ? ' pending' : ''}`}
      onClick={pr === undefined ? undefined : props.onSelect}
      onDoubleClick={pr === undefined ? undefined : props.onAccept}
      onKeyDown={(e) => {
        if (pr === undefined) return;
        if (e.key === 'Enter') props.onAccept();
        else if (e.key === ' ') (e.preventDefault(), props.onSelect());
      }}
      aria-pressed={props.selected}
      aria-disabled={pr === undefined}
      title="Klick wählt, Doppelklick oder Enter übernimmt"
    >
      <span className="proposal-image">
        {slot.image !== undefined ? <img src={slot.image} alt={`Vorschlag ${props.index + 1} in 3D`} /> : <span className="muted small">{slot.error ?? slot.status ?? 'wird berechnet …'}</span>}
      </span>
      {slot.label !== undefined && (
        <span className={`badge proposal-label ${slot.label}`} title={slot.reason}>
          {PROPOSAL_LABEL_TEXT[slot.label]}
        </span>
      )}
      {slot.reason !== undefined && <span className="proposal-reason small">{slot.reason}</span>}
      {pr !== undefined && facts !== undefined && (
        <>
          <span className="proposal-sketches">
            {floors.map((f) => (
              <PlanSketch key={f} plan={pr.plan} floor={f} size={floors.length > 3 ? 44 : 64} roomTypeName={props.roomTypeName} />
            ))}
          </span>
          <span className="proposal-facts small">
            <strong>
              {facts.width} × {facts.depth}
            </strong>{' '}
            · {facts.floors} {facts.floors === 1 ? 'Etage' : 'Etagen'}
            {facts.cellar ? ' + Keller' : ''} · {plural(facts.rooms, 'Raum', 'Räume')}
            {facts.volumes > 1 ? ` · ${facts.volumes} Baukörper` : ''}
          </span>
          <span className="proposal-facts small muted mono">
            Seed {slot.seed}
            {pr.plan.warnings.length > 0 ? ' · ungeprüft' : ''}
          </span>
          {slot.notice !== undefined && (
            <span className="small proposal-notice" role="note" title="Keine spielbare Variante in dieser Runde gefunden – „↻ 3 neue“ würfelt weiter">
              {slot.notice}
            </span>
          )}
          {props.same.length > 1 && (
            <span className="badge same" title={`Seeds ${props.same.join(', ')} ergeben denselben Grundriss – als eine Karte zusammengefasst`}>
              {props.same.length}× gleicher Grundriss
            </span>
          )}
        </>
      )}
    </div>
  );
}
