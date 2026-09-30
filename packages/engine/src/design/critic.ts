/**
 * F-JEV-iterativ, Kritiker: aus dem Plan die Anforderungen der Bitte, je Anforderung eine Frage an das Modell
 * (`noul` „erfüllt die Welt …?“, `score` für Größe und Stimmung), ein Gesamturteil (`score`) und „was fehlt?“
 * (`choice`). Jede Frage hat eine lokale Antwort aus dem Zusammenfasser (Zählen, Vergleichen). Nicht erfüllte
 * Anforderungen werden zu Planänderungen (Größe, Stimmungsachse, Teil, Raum, Keller, Brücken, sonst neue Variante).
 * Rein und deterministisch.
 */
import type { MoodAxis } from '@mcda/core';
import type { DecisionAnswer, DecisionQuestion } from '../intent/decisions.js';
import { NOT_SPECIFIED } from '../intent/decisions.js';
import type { Vocabulary } from '../vocabulary.js';
import { DESIGN_MOOD_AXES, POLES, type DesignPlan } from './plan.js';
import type { Realized } from './realize.js';

export type RequirementKind = 'type' | 'room' | 'wall' | 'tower' | 'windmill' | 'silo' | 'bridge' | 'cellar' | 'theme' | 'floors' | 'size' | 'mood';

export interface Requirement {
  readonly id: string;
  readonly kind: RequirementKind;
  /** Anforderung in Nutzersprache („Es gibt einen Raum Schmiede“). */
  readonly text: string;
  readonly target?: string | number;
  readonly axis?: MoodAxis;
}

const SIZES = ['S', 'M', 'L'] as const;
const SIZE_WORD: Readonly<Record<string, string>> = { S: 'klein', M: 'mittelgroß', L: 'groß' };
const CONTEXT = 'Der Zustand beschreibt eine erzeugte Minecraft-Anlage (Zusammenfassung „welt“) und die Bitte des Nutzers. ';

/** Anforderungen der Bitte laut Plan (nur, was die Bitte nennt; das Hauptgebäude immer). */
export function requirementsOf(plan: DesignPlan, vocab: Vocabulary): Requirement[] {
  const b = plan.base;
  const asked = new Set(plan.asked);
  const out: Requirement[] = [];
  const typeId = String(b['buildingTypeId'] ?? '');
  const typeName = vocab.buildingTypes.find((t) => t.id === typeId)?.name ?? typeId;
  out.push({ id: 'type', kind: 'type', text: `Das Hauptgebäude ist ein(e) ${typeName}`, target: typeId });
  if (asked.has('themeId') && typeof b['themeId'] === 'string') {
    const name = vocab.themes.find((t) => t.id === b['themeId'])?.name ?? String(b['themeId']);
    out.push({ id: 'theme', kind: 'theme', text: `Stil bzw. Material: ${name}`, target: String(b['themeId']) });
  }
  const typeSizes = vocab.buildingTypes.find((t) => t.id === typeId)?.sizes ?? [];
  if (asked.has('size') && typeof b['size'] === 'string' && typeSizes.includes(b['size'] as 'S')) out.push({ id: 'size', kind: 'size', text: `Die Größe passt zur Bitte (${SIZE_WORD[b['size']] ?? b['size']})`, target: b['size'] });
  if (asked.has('floors') && typeof b['floors'] === 'number') out.push({ id: 'floors', kind: 'floors', text: `Das Gebäude hat ${b['floors']} Etagen`, target: b['floors'] });
  if (b['underground'] === true) out.push({ id: 'cellar', kind: 'cellar', text: 'Es gibt Keller bzw. Gewölbe unter dem Haus' });
  for (const r of plan.rooms) {
    const name = vocab.roomTypes.find((x) => x.id === r)?.name ?? r;
    out.push({ id: `room.${r}`, kind: 'room', text: `Es gibt einen Raum „${name}“`, target: r });
  }
  const p = plan.parts;
  if (p.wall !== undefined) {
    out.push({ id: 'wall', kind: 'wall', text: p.wall === 'garden' ? 'Eine Gartenmauer umgibt die Anlage' : 'Eine Wehrmauer umgibt die Anlage' });
  }
  if (p.towers > 0) out.push({ id: 'tower', kind: 'tower', text: p.towers === 1 ? 'Neben dem Hauptgebäude steht ein freistehender Turm' : `Neben dem Hauptgebäude stehen ${p.towers} freistehende Türme`, target: p.towers });
  if (p.windmill) out.push({ id: 'windmill', kind: 'windmill', text: 'Es gibt eine Windmühle' });
  if (p.silo) out.push({ id: 'silo', kind: 'silo', text: 'Es gibt ein Silo' });
  if (p.bridge) out.push({ id: 'bridge', kind: 'bridge', text: 'Eine Brücke verbindet ein Obergeschoss mit der Mauer bzw. einem Nachbarbau' });
  const mood = (b['mood'] ?? {}) as Partial<Record<MoodAxis, number>>;
  for (const axis of DESIGN_MOOD_AXES) {
    const v = mood[axis];
    if (v === undefined || v === 0) continue;
    const [neg, pos] = POLES[axis];
    out.push({ id: `mood.${axis}`, kind: 'mood', axis, text: `Die Anlage wirkt ${v < 0 ? neg : pos}`, target: v });
  }
  return out;
}

/** Lokale Prüfung einer Anforderung am Zusammenfasser (1 erfüllt, 0 nicht). */
export function checkLocal(req: Requirement, w: Realized): number {
  const s = w.summary;
  switch (req.kind) {
    case 'type': return s.bautypId === req.target ? 1 : 0;
    case 'theme': return s.themeId === req.target ? 1 : 0;
    case 'size': return s.groessenklasse === req.target ? 1 : 0;
    case 'floors': return s.etagen >= Number(req.target) ? 1 : 0;
    case 'cellar': return s.keller ? 1 : 0;
    case 'room': return w.roomTypes.includes(String(req.target)) ? 1 : 0;
    case 'wall': return s.bauwerke.mauern > 0 ? 1 : 0;
    case 'tower': return s.bauwerke.freistehendeTuerme >= Number(req.target ?? 1) || (s.bautypId === 'watchtower' && s.bauwerke.freistehendeTuerme >= Number(req.target ?? 1) - 1) ? 1 : 0;
    case 'windmill': return s.bauwerke.windmuehlen > 0 ? 1 : 0;
    case 'silo': return s.bauwerke.silos > 0 ? 1 : 0;
    case 'bridge': return s.bruecken > 0 ? 1 : 0;
    case 'mood': {
      const want = Number(req.target);
      const got = w.mood[req.axis!] ?? 0;
      return Math.sign(got) === Math.sign(want) && Math.abs(got) >= Math.abs(want) * 0.5 ? 1 : 0;
    }
  }
}

const PART_OPTIONS: Readonly<Record<string, string>> = {
  nothing: 'Nichts – alles Verlangte ist da.',
  wall: 'eine Mauer um die Anlage',
  tower: 'ein freistehender Turm',
  windmill: 'eine Windmühle',
  silo: 'ein Silo',
  bridge: 'eine Brücke bzw. ein Übergang',
  cellar: 'ein Keller bzw. Gewölbe',
  room: 'ein bestimmter Raum bzw. eine Nutzung',
  bigger: 'mehr Größe bzw. mehr Etagen',
};
const OVERALL = ['erfüllt die Bitte gar nicht', 'erfüllt die Bitte kaum', 'erfüllt die Bitte teilweise', 'erfüllt die Bitte weitgehend', 'erfüllt die Bitte vollständig'];
const SIZE_LEVELS = ['deutlich zu klein', 'etwas zu klein', 'passend', 'etwas zu groß', 'deutlich zu groß'];

type Q = Record<string, DecisionQuestion>;
type A = Record<string, DecisionAnswer>;

/** Fragen des Kritikers für eine Welt, dazu die lokalen Antworten. */
export function criticRound(reqs: readonly Requirement[], w: Realized, vocab: Vocabulary): { questions: Q; local: A } {
  const questions: Q = {};
  const local: A = {};
  for (const r of reqs) {
    const ok = checkLocal(r, w);
    if (r.kind === 'size') {
      questions['crit.size'] = { type: 'score', instructions: `${CONTEXT}Passt die Größe der Welt (Größenklasse, Maße, Etagen, Räume) zur Bitte?`, criteria: SIZE_LEVELS };
      const d = SIZES.indexOf((w.summary.groessenklasse ?? 'M') as 'S') - SIZES.indexOf(r.target as 'S');
      local['crit.size'] = { type: 'score', score: 2 + Math.max(-2, Math.min(2, d)), confidence: 0.9 };
      continue;
    }
    if (r.kind === 'mood') {
      const [neg, pos] = POLES[r.axis!];
      questions[`crit.mood.${r.axis}`] = {
        type: 'score', instructions: `${CONTEXT}Wirkt die Welt (siehe „stimmung“, „materialien“, „raeume“) so ${neg} bzw. ${pos}, wie die Bitte es will?`,
        criteria: [`deutlich zu ${neg}`, `etwas zu ${neg}`, 'passend', `etwas zu ${pos}`, `deutlich zu ${pos}`],
      };
      const got = w.mood[r.axis!] ?? 0;
      const want = Number(r.target);
      local[`crit.mood.${r.axis}`] = { type: 'score', score: ok === 1 ? 2 : got < want ? 1 : 3, confidence: 0.9 };
      continue;
    }
    questions[`req.${r.id}`] = {
      type: 'noul', instructions: `${CONTEXT}Erfüllt die Welt laut Zusammenfassung diese Anforderung der Bitte: „${r.text}“?`,
      criteria: { true: 'Ja, die Zusammenfassung zeigt, dass die Welt das erfüllt.', false: 'Nein oder nur teilweise.' },
    };
    local[`req.${r.id}`] = { type: 'noul', noul: ok === 1 ? 0.95 : 0.05 };
  }
  questions['crit.overall'] = { type: 'score', instructions: `${CONTEXT}Wie gut erfüllt die Welt die Bitte insgesamt?`, criteria: OVERALL };
  questions['crit.missing'] = {
    type: 'choice', instructions: `${CONTEXT}Was fehlt der Welt am deutlichsten, obwohl die Bitte es ausdrücklich verlangt?`,
    criteria: PART_OPTIONS,
  };
  questions['crit.missingRoom'] = {
    type: 'choice',
    instructions: `${CONTEXT}Welche in der Bitte ausdrücklich genannte Nutzung bzw. welcher Raum fehlt in „raeume“? Fehlt keiner: ${NOT_SPECIFIED}.`,
    criteria: {
      ...Object.fromEntries(vocab.roomTypes.map((r) => [r.id, r.name])),
      [NOT_SPECIFIED]: 'Es fehlt kein genannter Raum.',
    },
  };
  const met = reqs.length === 0 ? 1 : reqs.reduce((s, r) => s + checkLocal(r, w), 0) / reqs.length;
  local['crit.overall'] = { type: 'score', score: Math.round(met * 4), confidence: 0.9 };
  const firstMiss = reqs.find((r) => checkLocal(r, w) === 0 && r.kind !== 'mood' && r.kind !== 'type' && r.kind !== 'theme');
  const miss = firstMiss === undefined ? 'nothing' : firstMiss.kind === 'size' || firstMiss.kind === 'floors' ? 'bigger' : firstMiss.kind;
  local['crit.missing'] = { type: 'choice', choice: miss, confidence: 0.9 };
  local['crit.missingRoom'] = { type: 'choice', choice: firstMiss?.kind === 'room' ? String(firstMiss.target) : NOT_SPECIFIED, confidence: 0.9 };
  return { questions, local };
}

/** Bewertung einer Welt: je Anforderung 0–1, dazu Gesamturteil und „was fehlt“. */
export interface Verdict {
  readonly score: number;
  readonly requirements: Readonly<Record<string, number>>;
  readonly overall: number;
  readonly missing?: string;
  readonly missingRoom?: string;
  /** Größe: Abweichung −2 … 2 (negativ = zu klein). */
  readonly sizeDelta?: number;
  /** Stimmung je Achse: Abweichung −2 … 2 (negativ = zu sehr Pol −1). */
  readonly moodDelta: Readonly<Partial<Record<MoodAxis, number>>>;
}

const scoreOf = (a: DecisionAnswer | undefined): number | undefined => (a?.type === 'score' && Number.isFinite(a.score) ? a.score : undefined);
/** „passend“ auf einer 5er-Skala als 0–1: Mitte 1, je Stufe Abweichung −0,5. */
const fit = (s: number): number => Math.max(0, 1 - Math.abs(s - 2) / 2);

/** Gewicht des Gesamturteils neben dem Mittel der Anforderungen. */
export const OVERALL_WEIGHT = 0.25;

export function readVerdict(reqs: readonly Requirement[], answers: Readonly<Record<string, DecisionAnswer | undefined>>, min: number): Verdict {
  const requirements: Record<string, number> = {};
  const moodDelta: Partial<Record<MoodAxis, number>> = {};
  let sizeDelta: number | undefined;
  for (const r of reqs) {
    if (r.kind === 'size') {
      const s = scoreOf(answers['crit.size']);
      if (s !== undefined) { requirements[r.id] = fit(s); sizeDelta = s - 2; }
      continue;
    }
    if (r.kind === 'mood') {
      const s = scoreOf(answers[`crit.mood.${r.axis}`]);
      if (s !== undefined) { requirements[r.id] = fit(s); moodDelta[r.axis!] = s - 2; }
      continue;
    }
    const a = answers[`req.${r.id}`];
    if (a?.type === 'noul' && Number.isFinite(a.noul)) requirements[r.id] = a.noul;
  }
  const o = scoreOf(answers['crit.overall']);
  const overall = o === undefined ? 0.5 : Math.max(0, Math.min(1, o / 4));
  const vals = Object.values(requirements);
  const mean = vals.length === 0 ? overall : vals.reduce((s, x) => s + x, 0) / vals.length;
  const m = answers['crit.missing'];
  const missing = m?.type === 'choice' && m.choice !== 'nothing' && (m.confidence ?? 0) >= min ? m.choice : undefined;
  const mr = answers['crit.missingRoom'];
  const missingRoom = mr?.type === 'choice' && mr.choice !== NOT_SPECIFIED && (mr.confidence ?? 0) >= min ? mr.choice : undefined;
  return {
    score: Math.round(((1 - OVERALL_WEIGHT) * mean + OVERALL_WEIGHT * overall) * 1000) / 1000,
    requirements, overall, moodDelta,
    ...(missing !== undefined ? { missing } : {}),
    ...(missingRoom !== undefined ? { missingRoom } : {}),
    ...(sizeDelta !== undefined ? { sizeDelta } : {}),
  };
}

/** Größenklassen des Bautyps. */
const sizesOf = (vocab: Vocabulary, typeId: unknown): readonly string[] => vocab.buildingTypes.find((t) => t.id === typeId)?.sizes ?? SIZES;

/**
 * Planänderungen aus der Bewertung. `failed` = Anforderungen unter 0,5. Jede Änderung ist eine vorhandene Stellgröße
 * (Größe, Etagen, Stimmung, Teil, Raum, Keller, Brücken, Variante); ohne Ansatzpunkt eine neue Variante (`rerollCount`).
 */
export function fixesOf(plan: DesignPlan, reqs: readonly Requirement[], v: Verdict, w: Realized, vocab: Vocabulary, round: number): { plan: DesignPlan; changes: string[] } {
  const base: Record<string, unknown> = { ...plan.base };
  let parts = { ...plan.parts };
  const rooms = [...plan.rooms];
  const asked = new Set(plan.asked);
  const changes: string[] = [];
  const sizes = sizesOf(vocab, base['buildingTypeId']);
  const bump = (dir: 1 | -1, why: string): void => {
    const cur = (base['size'] as string | undefined) ?? w.summary.groessenklasse ?? sizes[Math.floor(sizes.length / 2)]!;
    const next = sizes[sizes.indexOf(cur) + dir];
    if (next !== undefined) { base['size'] = next; delete base['floors']; changes.push(`Größe ${cur} → ${next} (${why})`); }
    else if (dir > 0 && typeof base['floors'] !== 'number') { base['floors'] = w.summary.etagen + 1; changes.push(`Etagen → ${w.summary.etagen + 1} (${why})`); }
  };
  const failed = reqs.filter((r) => (v.requirements[r.id] ?? 1) < 0.5);
  for (const r of failed) {
    switch (r.kind) {
      case 'room':
        if (!w.roomTypes.includes(String(r.target)) && w.notes.some((n) => n.startsWith(`kein freier Raum für ${r.target}`))) bump(1, `Platz für ${r.target}`);
        break;
      case 'wall': case 'tower': case 'windmill': case 'silo':
        if (r.kind === 'wall' && parts.wall === undefined) parts = { ...parts, wall: 'fortress' };
        else if (r.kind === 'tower' && parts.towers === 0) parts = { ...parts, towers: 1 };
        else if (r.kind === 'windmill') parts = { ...parts, windmill: true };
        else if (r.kind === 'silo') parts = { ...parts, silo: true };
        else { parts = { ...parts, shift: parts.shift + 4 }; changes.push(`Nebenteile weiter weg (+4, ${r.kind})`); break; }
        changes.push(`Teil ergänzt: ${r.kind}`);
        break;
      case 'bridge':
        if (base['ensemble'] !== true) { base['ensemble'] = true; changes.push('Brücken/Ensemble an'); }
        if (parts.wall === undefined && w.summary.bauwerke.mauern === 0) { parts = { ...parts, wall: 'fortress' }; changes.push('Mauer für den Wehrgang-Anschluss'); }
        if (w.summary.etagen < 2 && typeof base['floors'] !== 'number') { base['floors'] = 2; changes.push('Etagen → 2 (Brücke aus dem Obergeschoss)'); }
        break;
      case 'cellar':
        if (base['underground'] !== true) { base['underground'] = true; changes.push('Keller an'); }
        break;
      case 'floors':
        if (typeof r.target === 'number' && w.summary.etagen < r.target) bump(1, `${r.target} Etagen`);
        break;
      case 'type':
        if (base['buildingTypeId'] !== r.target) { base['buildingTypeId'] = r.target; changes.push(`Bautyp → ${r.target}`); }
        break;
      case 'theme':
        if (base['themeId'] !== r.target) { base['themeId'] = r.target; changes.push(`Theme → ${r.target}`); }
        break;
      default:
        break;
    }
  }
  if (v.sizeDelta !== undefined && Math.abs(v.sizeDelta) >= 0.75 && !changes.some((c) => c.startsWith('Größe'))) bump(v.sizeDelta < 0 ? 1 : -1, v.sizeDelta < 0 ? 'zu klein' : 'zu groß');
  const mood: Record<string, number> = { ...((base['mood'] as Record<string, number> | undefined) ?? {}) };
  let moodChanged = false;
  for (const [axis, d] of Object.entries(v.moodDelta) as Array<[MoodAxis, number]>) {
    if (Math.abs(d) < 0.75) continue;
    const cur = mood[axis] ?? 0;
    const next = Math.max(-1, Math.min(1, cur - Math.sign(d) * 0.5));
    if (next !== cur) { mood[axis] = next; moodChanged = true; changes.push(`Stimmung ${axis} ${cur} → ${next}`); }
  }
  if (moodChanged) base['mood'] = mood;
  // „Was fehlt“ ergänzt Teile, die der Planer übersehen hat
  if (v.missing !== undefined) {
    const m = v.missing;
    if (m === 'wall' && parts.wall === undefined && w.summary.bauwerke.mauern === 0) { parts = { ...parts, wall: 'fortress' }; changes.push('Kritiker: Mauer ergänzt'); asked.add('wall'); }
    if (m === 'tower' && parts.towers === 0) { parts = { ...parts, towers: 1 }; changes.push('Kritiker: Turm ergänzt'); }
    if (m === 'windmill' && !parts.windmill) { parts = { ...parts, windmill: true }; changes.push('Kritiker: Windmühle ergänzt'); }
    if (m === 'silo' && !parts.silo) { parts = { ...parts, silo: true }; changes.push('Kritiker: Silo ergänzt'); }
    if (m === 'bridge' && !parts.bridge) { parts = { ...parts, bridge: true }; base['ensemble'] = true; changes.push('Kritiker: Brücke ergänzt'); }
    if (m === 'cellar' && base['underground'] !== true) { base['underground'] = true; changes.push('Kritiker: Keller ergänzt'); }
    if (m === 'bigger' && !changes.some((c) => c.startsWith('Größe') || c.startsWith('Etagen'))) bump(1, 'Kritiker: mehr Größe');
  }
  if (v.missingRoom !== undefined && !rooms.includes(v.missingRoom) && !w.roomTypes.includes(v.missingRoom) && rooms.length < 4) {
    rooms.push(v.missingRoom);
    changes.push(`Kritiker: Raum ${v.missingRoom} ergänzt`);
  }
  // Kein Ansatzpunkt, aber nicht gut genug: neue Variante (anderer Grundriss bei gleichem Seed)
  if (changes.length === 0 && failed.length > 0) {
    base['rerollCount'] = Number(base['rerollCount'] ?? 0) + 1;
    changes.push(`neue Variante (rerollCount ${String(base['rerollCount'])}, Runde ${round})`);
  }
  return { plan: { base, parts, rooms, asked: [...asked].sort() }, changes };
}
